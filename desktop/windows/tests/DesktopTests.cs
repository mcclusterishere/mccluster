using System;
using System.Collections.Generic;
using System.IO;
using McClusterDesktop;

// Pester-free, dependency-free checks: navigation/security policy (unchanged from the
// 0.1.0 preview, plus the owner-chat route) and the local job store's reconnect rules.
internal static class DesktopTests
{
    private static int checks;
    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception("FAILED: " + message);
        checks++;
    }

    private static int Main()
    {
        try
        {
            NavigationPolicyChecks();
            JobStoreChecks();
            AdapterChecks();
            ProofChecks();
            ExoProbeChecks();
            JsonChecks();
            Console.WriteLine(checks + " desktop checks passed.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static void NavigationPolicyChecks()
    {
        Assert(NavigationPolicy.Home == "https://mccluster.org/", "production launch origin");
        Assert(NavigationPolicy.IsFirstParty(NavigationPolicy.HttpsTarget(NavigationPolicy.OwnerChat)), "owner chat route is first party");
        foreach (string url in new[] { "https://mccluster.org/", "https://mccluster.org/account.html", "HTTPS://MCCLUSTER.ORG:443/path", "https://matthew.mccluster.org/album.html", "https://humanuprise.com/" })
            Assert(NavigationPolicy.IsFirstParty(NavigationPolicy.HttpsTarget(url)), "first-party allowed: " + url);
        foreach (string url in new[] { "https://mccluster.org.example.net/", "https://example.net/mccluster.org", "https://api.mccluster.org/", "https://compute.mccluster.org/", "https://mccluster.org./", "https://accounts.google.com/", "https://www.mccluster.org/" })
            Assert(!NavigationPolicy.IsFirstParty(NavigationPolicy.HttpsTarget(url)), "not first party: " + url);
        foreach (string url in new[] { "http://mccluster.org/", "https://mccluster.org:8443/", "https://mccluster.org@example.net/", "https://evil@example.net/", "javascript:alert(1)", "file:///c:/windows/", "https://127.0.0.1/", "https://[::1]/", "https://mccluster.org/\\foo", "https://mccluster.org/\rfoo", "//mccluster.org/", "", null })
            Assert(NavigationPolicy.HttpsTarget(url) == null, "non-standard external target blocked: " + url);
        foreach (string url in new[] { "https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1/authorize?provider=google", "https://accounts.google.com/o/oauth2/v2/auth", "https://appleid.apple.com/auth/authorize", "https://www.facebook.com/v19.0/dialog/oauth", "https://x.com/oauth/authenticate" })
            Assert(NavigationPolicy.IsProviderLogin(NavigationPolicy.HttpsTarget(url)), "social uses system browser: " + url);
        Assert(!NavigationPolicy.IsProviderLogin(NavigationPolicy.HttpsTarget("https://accounts.google.com.evil.tld/")), "OAuth spoof blocked");
        Assert(NavigationPolicy.BrowserPage("https://matthew.mccluster.org/auth/?code=not-for-transfer#state").AbsoluteUri == "https://matthew.mccluster.org/auth/", "browser fallback strips query and fragment");
        Assert(NavigationPolicy.BrowserPage("https://foo.tld/auth/?code=not-for-transfer#state").AbsoluteUri == NavigationPolicy.Home, "browser fallback cannot pivot origin");
    }

    private static void JobStoreChecks()
    {
        string root = Path.Combine(Path.GetTempPath(), "mccluster-desktop-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JobStore(root);
            LocalJob job = store.Create(JobKind.Inventory, JobTarget.LocalDevice, new Dictionary<string, object> { { "path", root } });
            Assert(job.Id.StartsWith("job_") && job.Id.Length == 36, "stable job id");
            Assert(job.State == JobState.Queued, "new job is queued");
            LocalJob again = store.Get(job.Id);
            Assert(again != null && again.Id == job.Id && again.State == JobState.Queued, "job round-trips through its file");

            // A job left running by a dead process is recovered as interrupted; input is kept.
            again.State = JobState.Running;
            again.OwnerPid = 999999;
            again.Progress = new Dictionary<string, object> { { "files_done", 3 } };
            store.Save(again);
            List<LocalJob> recovered = store.RecoverInterrupted();
            Assert(recovered.Count == 1 && recovered[0].State == JobState.Interrupted, "dead-owner running job becomes interrupted");
            LocalJob after = store.Get(job.Id);
            Assert(after.State == JobState.Interrupted && after.Input.ContainsKey("path") && after.Progress != null, "interrupted job keeps input and progress");
            Assert(store.RecoverInterrupted().Count == 0, "recovery is idempotent");

            // A job owned by a live process is left alone.
            LocalJob live = store.Create(JobKind.Chat, JobTarget.LocalDevice, new Dictionary<string, object> { { "prompt", "x" } });
            live.State = JobState.Running;
            live.OwnerPid = System.Diagnostics.Process.GetCurrentProcess().Id;
            store.Save(live);
            Assert(store.RecoverInterrupted().Count == 0 && store.Get(live.Id).State == JobState.Running, "live-owner running job is untouched");

            // Remote and group targets never execute inside the app.
            LocalJob remote = store.Create(JobKind.Chat, JobTarget.RemoteWorker, new Dictionary<string, object>());
            bool refused = false;
            try { new JobRunner(store).Run(remote, null, System.Threading.CancellationToken.None).Wait(); }
            catch (AggregateException ex) { refused = ex.InnerException is InvalidOperationException; }
            Assert(refused, "remote-worker job is refused by the local runner");

            // Drafts survive a restart of the store.
            store.SaveDraft(JobTarget.LocalDevice, "keep me", JobKind.Inventory, root);
            Dictionary<string, object> draft = new JobStore(root).LoadDraft();
            Assert(draft != null && Json.Str(draft, "text") == "keep me", "draft persists across store instances");

            // Listing is newest first.
            List<LocalJob> list = store.List();
            Assert(list.Count == 3 && string.CompareOrdinal(list[0].CreatedAt, list[2].CreatedAt) >= 0, "jobs list newest first");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (Exception) { }
        }
    }

    private static void AdapterChecks()
    {
        var status = new AdapterStatus();
        status.Implementations.Add(new AdapterImplementation { Implementation = "qwen3-vl.4b.local", Model = "qwen3-vl:4b", Installed = true, Digest = "abc" });
        status.Implementations.Add(new AdapterImplementation { Implementation = "qwen3.8b.local", Model = "qwen3:8b", Installed = false });
        Assert(status.ImplementationFor("qwen3-vl:4b").Implementation == "qwen3-vl.4b.local", "installed implementation matched by model");
        Assert(status.ImplementationFor("QWEN3-VL:4B").Implementation == "qwen3-vl.4b.local", "model match ignores case");
        Assert(status.ImplementationFor("qwen3:8b") == null, "an uninstalled implementation is never selected");
        Assert(status.ImplementationFor("llama3") == null && status.ImplementationFor(null) == null, "unknown or empty model selects nothing");
        Assert(LocalRuntime.AdapterUrl().StartsWith("http://127.0.0.1:"), "adapter is loopback only");
    }

    private static void ProofChecks()
    {
        // The canonical JSON test vector from docs/control-plane/DEVICE-JOBS-CONTRACT.md (PR #823).
        object vector = Json.Parse("{ \"z\": 1.0, \"a\": [true, null, \"é\\n\\\"\", { \"b\": 1e21, \"c\": -0, \"d\": 0.1 }], \"m\": { \"y\": \"x\", \"x\": \"y\" } }");
        string canonical = Canonical.Json(vector);
        Assert(canonical == "{\"a\":[true,null,\"é\\n\\\"\",{\"b\":1e+21,\"c\":0,\"d\":0.1}],\"m\":{\"x\":\"y\",\"y\":\"x\"},\"z\":1}", "canonical JSON matches the contract vector: " + canonical);
        Assert(Canonical.Sha256Hex(canonical) == "d9a258d84feed22118930490e012edba6c031ee62716e40701d03480177206f8", "canonical hash matches the contract vector");

        string root = Path.Combine(Path.GetTempPath(), "mccluster-proof-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var receipt = new Dictionary<string, object> { { "schema", "mccluster-desktop-receipt/2" }, { "attempt", 1 }, { "output_sha256", "abc" }, { "inference", new Dictionary<string, object> { { "mode", "single-device" } } } };
            using (DeviceKey key = DeviceKey.Load(root))
            {
                key.Sign(receipt);
                Assert((bool)receipt["signed"] && Json.Str(receipt["signature"], "alg") == "ecdsa-p256-sha256", "receipt is signed with the device key");
                Assert(Json.Str(receipt["signature"], "key_id") == key.KeyId, "signature names the device key id");
            }
            string reason;
            Assert(DeviceKey.Verify(receipt, out reason), "signed receipt verifies offline: " + reason);
            object roundTrip = Json.Parse(Json.Pretty(receipt));
            Assert(DeviceKey.Verify(roundTrip, out reason), "receipt still verifies after a JSON round trip: " + reason);
            var tampered = Json.Obj(Json.Parse(Json.Pretty(receipt)));
            tampered["output_sha256"] = "def";
            Assert(!DeviceKey.Verify(tampered, out reason) && reason == "signature does not verify", "a tampered receipt is rejected");
            var unsigned = new Dictionary<string, object> { { "schema", "x" } };
            Assert(!DeviceKey.Verify(unsigned, out reason) && reason == "unsigned", "an unsigned receipt is reported as unsigned");
            using (DeviceKey again = DeviceKey.Load(root)) Assert(again.KeyId == Json.Str(receipt["signature"], "key_id"), "the device key persists across loads");
        }
        finally { try { Directory.Delete(root, true); } catch (Exception) { } }

        // Context routes: first-party only.
        bool refused = false;
        try { ContextRefs.SiteRoute("https://example.com/", 100).Wait(); } catch (AggregateException ex) { refused = ex.InnerException is ArgumentException; }
        Assert(refused, "a context route outside the first-party hosts is refused");
        refused = false;
        try { ContextRefs.SiteRoute("http://mccluster.org/", 100).Wait(); } catch (AggregateException ex) { refused = ex.InnerException is ArgumentException; }
        Assert(refused, "a plain-http context route is refused");
    }

    private static void ExoProbeChecks()
    {
        Assert(!ExoProbe.IsLoopback("http://192.168.1.11:52415") && !ExoProbe.IsLoopback("https://exo.example/") && ExoProbe.IsLoopback("http://127.0.0.1:52415") && ExoProbe.IsLoopback("http://localhost:52415"), "the EXO probe accepts loopback runtimes only");
        var refusedReceipt = ExoProbe.RankReceipt("http://192.168.1.11:52415", "node_x").Result;
        Assert(refusedReceipt.ContainsKey("error") && (bool)refusedReceipt["inference_verified"] == false, "a non-loopback runtime yields an error receipt, never a claim");

        // A loopback fixture that answers like the audited EXO release: /node_id as a bare JSON string, /state with a topology of two nodes.
        var listener = new System.Net.HttpListener();
        int port = 52900 + new Random().Next(0, 90);
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        listener.Start();
        var serving = System.Threading.Tasks.Task.Run((Action)delegate
        {
            for (int i = 0; i < 2; i++)
            {
                System.Net.HttpListenerContext ctx = listener.GetContext();
                string body = ctx.Request.Url.AbsolutePath == "/node_id" ? "\"rank-a-fixture\"" : "{\"topology\":{\"nodes\":{\"rank-a-fixture\":{\"lastSeen\":\"2026-11-23T00:00:00Z\",\"memory\":{\"total\":17179869184}},\"rank-b-fixture\":{\"lastSeen\":\"2026-11-23T00:00:01Z\"}}},\"instances\":[]}";
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(body);
                ctx.Response.ContentType = "application/json";
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.Close();
            }
        });
        try
        {
            var receipt = ExoProbe.RankReceipt("http://127.0.0.1:" + port, "node_abc").Result;
            Assert(!receipt.ContainsKey("error"), "fixture probe succeeds: " + (receipt.ContainsKey("error") ? Convert.ToString(receipt["error"]) : ""));
            Assert(Convert.ToString(receipt["runtime_node_id"]) == "rank-a-fixture", "runtime node id read from /node_id");
            Assert((int)receipt["member_count"] == 2 && (bool)receipt["two_rank_candidate"], "two members seen in /state");
            Assert(Convert.ToString(receipt["inference_mode"]) == "two-rank-exo (untested)" && (bool)receipt["inference_verified"] == false, "two members is topology, never a shared-inference claim");
            Assert(Convert.ToString(receipt["schema"]) == "exo-rank-receipt/1" && receipt["state_sha256"] != null, "rank receipt carries schema and state hash");
        }
        finally { listener.Stop(); serving.Wait(2000); }
    }

    private static void JsonChecks()
    {
        object parsed = Json.Parse("{\"a\":1,\"b\":[true,\"x\"],\"c\":{\"d\":null}}");
        Assert(Json.Num(parsed, "a") == 1, "json number");
        Assert(Json.List(parsed, "b").Count == 2, "json array");
        Assert(Json.Get(Json.Get(parsed, "c"), "d") == null, "json null");
        string pretty = Json.Pretty(parsed);
        Assert(pretty.Contains("\"a\": 1") && pretty.EndsWith("}\n"), "pretty printer");
        Assert(Json.Quote("a\"b\n") == "\"a\\\"b\\n\"", "string escaping");
    }
}
