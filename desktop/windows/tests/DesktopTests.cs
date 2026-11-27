using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
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
            OwnerChatTests.Run(Assert);
            CallSessionTests.Run();
            JobStoreChecks();
            AdapterChecks();
            ProofChecks();
            ExoProbeChecks();
            JsonChecks();
            MeteringChecks();
            QuoteArgChecks();
            ContributionChecks();
            CoreStagingProfileChecks();
            CoreStagingTlsChecks();
            CoreStagingClientChecks();
            PanelRunsChecks();
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
        Assert(NavigationPolicy.OwnerChat == "https://mccluster.org/control.html#home:ask" && NavigationPolicy.IsPanelDestination(NavigationPolicy.OwnerChat), "the owner action opens the canonical signed-in room");
        Assert(NavigationPolicy.IsPanelDestination(NavigationPolicy.OwnerProjects) && NavigationPolicy.OwnerProjects == "https://mccluster.org/control.html#create:projects", "the Projects control opens its authenticated first-party route");
        Assert(NavigationPolicy.IsPanelDestination(NavigationPolicy.Home), "the native Home action is supported");
        foreach (string url in new[] { null, "", NavigationPolicy.OwnerChat + "&message=sample", "https://mccluster.org/control.html?target=auto#home:ask", "https://mccluster.org/account.html", "https://matthew.mccluster.org/control.html#home:ask", "https://external.example/" })
            Assert(!NavigationPolicy.IsPanelDestination(url), "native chat cannot forward data or select arbitrary destinations");
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
            LocalConversationChecks(store);
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (Exception) { }
        }
    }

    private static void LocalConversationChecks(JobStore store)
    {
        var session = new LocalConversation();
        LocalJob first = session.Create(store, "fixture-model", "First question");
        Assert(Json.Str(first.Input, "device") == DeviceChoice.Ollama && first.Target == JobTarget.LocalDevice &&
            Json.Num(first.Input, "max_attempts") == 1, "native chat pins loopback Ollama for one attempt");
        Assert(LocalConversation.Messages(store, first, "First question").Count == 1, "a new chat has only its own message");
        first.State = JobState.Done;
        first.Result = new Dictionary<string, object> { { "content", "First answer" } };
        first.Receipt = new Dictionary<string, object> { { "job_id", first.Id }, { "state", JobState.Done },
            { "schema", "mccluster-desktop-receipt/2" }, { "kind", JobKind.Chat },
            { "evidence_scope", "local_device_only" }, { "hosted_inference_used", false },
            { "input_sha256", Canonical.Sha256Hex(Canonical.Json(first.Input)) },
            { "output_sha256", Canonical.Sha256Hex(Canonical.Json(first.Result)) } };
        using (DeviceKey key = DeviceKey.Load(store.Root)) key.Sign(first.Receipt);
        store.Save(first);
        LocalJob second = session.Create(store, "fixture-model", "Follow up");
        List<object> messages = LocalConversation.Messages(store, second, "Follow up");
        Assert(messages.Count == 3 && Json.Str(messages[0], "role") == "user" &&
            Json.Str(messages[1], "role") == "assistant" && Json.Str(messages[1], "content") == "First answer" &&
            Json.Str(messages[2], "content") == "Follow up", "follow-up uses verified turns with their original roles");
        LocalJob separate = new LocalConversation().Create(store, "fixture-model", "New conversation");
        Assert(Json.List(separate.Input, "history_jobs").Count == 0, "new conversation excludes earlier local jobs");
        separate.Input["history_jobs"] = new[] { first.Id };
        bool refused = false;
        try { LocalConversation.Messages(store, separate, "New conversation"); } catch (InvalidDataException) { refused = true; }
        Assert(refused, "even a valid same-device job from another conversation is refused");
        first.Result["content"] = "Modified answer";
        store.Save(first);
        refused = false;
        try { LocalConversation.Messages(store, second, "Follow up"); } catch (InvalidDataException) { refused = true; }
        Assert(refused, "altered prior answers never reach local inference");
        first.Result["content"] = "First answer";
        first.Receipt.Remove("output_sha256");
        using (DeviceKey key = DeviceKey.Load(store.Root)) key.Sign(first.Receipt);
        store.Save(first);
        refused = false;
        try { LocalConversation.Messages(store, second, "Follow up"); } catch (InvalidDataException) { refused = true; }
        Assert(refused, "a signature without an output hash cannot verify a previous chat answer");
        separate.Input["history_jobs"] = new[] { "../outside" };
        refused = false;
        try { LocalConversation.Messages(store, separate, "New conversation"); } catch (InvalidDataException) { refused = true; }
        Assert(refused, "invalid history file names refused before lookup");
        refused = false;
        try { session.Create(store, "fixture-model", new string('x', LocalConversation.MaxPrompt + 1)); } catch (ArgumentException) { refused = true; }
        Assert(refused, "oversized local prompts are refused before creating a job");
        RestoredConversationChecks(store);
    }

    private static void SaveChatFixture(JobStore store, LocalJob job, string state, string detail, string finished)
    {
        job.State = state;
        job.Receipt = new Dictionary<string, object> {
            { "schema", "mccluster-desktop-receipt/2" }, { "job_id", job.Id }, { "kind", JobKind.Chat },
            { "state", state }, { "evidence_scope", "local_device_only" }, { "hosted_inference_used", false },
            { "finished_at", finished }, { "input_sha256", Canonical.Sha256Hex(Canonical.Json(job.Input)) } };
        if (state == JobState.Done)
        {
            job.Result = new Dictionary<string, object> { { "content", detail } };
            job.Receipt["output_sha256"] = Canonical.Sha256Hex(Canonical.Json(job.Result));
        }
        else { job.Error = detail; job.Receipt["failure"] = detail; }
        using (DeviceKey key = DeviceKey.Load(store.Root)) key.Sign(job.Receipt);
        store.Save(job);
    }

    private static void RestoredConversationChecks(JobStore store)
    {
        var older = new LocalConversation();
        var recent = new LocalConversation();
        var legacy = older.Create(store, "model", "  First\n question ");
        legacy.Input.Remove("local_chat_route");
        legacy.Input.Remove("local_chat_title");
        SaveChatFixture(store, legacy, JobState.Done, "Earlier answer", "2026-11-26T20:00:00Z");
        var failed = older.Create(store, "model", "Question that stopped");
        SaveChatFixture(store, failed, JobState.Failed, "canceled by the owner", "2026-11-26T21:00:00Z");
        failed.Error = "Unsigned replacement";
        failed.Result = new Dictionary<string, object> { { "content", "Unsigned answer" } };
        store.Save(failed);
        var latest = recent.Create(store, "model", "Different conversation");
        SaveChatFixture(store, latest, JobState.Done, "Latest answer", "2026-11-26T22:00:00Z");
        recent.Create(store, "model", "Still unsigned");
        var standalone = new LocalConversation().Create(store, "model", "From Compute");
        standalone.Input.Remove("local_chat_id");
        SaveChatFixture(store, standalone, JobState.Done, "Standalone result", "2026-11-26T23:00:00Z");
        var forged = new LocalConversation().Create(store, "model", "Do not display");
        SaveChatFixture(store, forged, JobState.Done, "An answer", "2026-11-26T23:00:00Z");
        forged.Input["local_chat_id"] = older.Id;
        store.Save(forged);
        var restored = LocalConversation.Restore(new JobStore(store.Root));
        Assert(restored.Count == 2 && restored[0].Id == recent.Id && restored[1].Id == older.Id,
            "restart groups only signed native turns and orders threads by signed completion time");
        Assert(restored[0].Turns.Count == 1 && restored[1].Turns.Count == 2 && restored[1].Turns[0].Id == legacy.Id &&
            restored[1].Turns[1].Id == failed.Id, "recovered turn order excludes standalone, unsigned and tampered rows");
        Assert(restored[1].Title == "First question" && restored[1].Route == "prime" && restored[1].Label.Contains("Prime"),
            "legacy native jobs recover the local route and normalized first prompt");
        Assert(restored[1].Turns[1].Error == "canceled by the owner" && restored[1].Turns[1].Result == null,
            "reopened cancellation uses signed failure text and displays no unsigned output");
        var continued = restored[1].Create(store, "model", "Continue");
        var history = LocalConversation.Messages(store, continued, "Continue");
        Assert(Json.Str(continued.Input, "local_chat_id") == older.Id && Json.Str(continued.Input, "local_chat_route") == "prime" &&
            history.Count == 3 && Json.Str(history[1], "content") == "Earlier answer",
            "a restored chat continues its exact thread and sends only its verified successful prior turn");
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
            string trustedKeyId;
            using (DeviceKey again = DeviceKey.Load(root)) { trustedKeyId = again.KeyId; Assert(again.KeyId == Json.Str(receipt["signature"], "key_id"), "the device key persists across loads"); }
            // A key file protected without entropy (the pre-release build) is read once and re-protected; key_id is unchanged.
            string keyPath = Path.Combine(root, "keys", "receipt-signing.p256.dpapi");
            byte[] withEntropy = File.ReadAllBytes(keyPath);
            byte[] rawKey = System.Security.Cryptography.ProtectedData.Unprotect(withEntropy, DeviceKey.Entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser);
            File.WriteAllBytes(keyPath, System.Security.Cryptography.ProtectedData.Protect(rawKey, null, System.Security.Cryptography.DataProtectionScope.CurrentUser));
            using (DeviceKey migrated = DeviceKey.Load(root)) Assert(migrated.KeyId == trustedKeyId, "a legacy key file without entropy loads with the same key_id");
            bool reprotected = false;
            try { System.Security.Cryptography.ProtectedData.Unprotect(File.ReadAllBytes(keyPath), DeviceKey.Entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser); reprotected = true; } catch (System.Security.Cryptography.CryptographicException) { }
            Assert(reprotected, "the legacy key file is re-protected with entropy after one load");
            File.WriteAllBytes(keyPath, new byte[] { 1, 2, 3 });
            bool unreadableRefused = false;
            try { DeviceKey.Load(root); } catch (System.Security.Cryptography.CryptographicException ex) { unreadableRefused = ex.Message.Contains("Move it aside"); }
            Assert(unreadableRefused, "an unreadable key file is refused with instructions, never silently replaced");
            // A forgery re-signed with a fresh key is self-consistent but not trusted.
            string otherRoot = root + "-other";
            try
            {
                var forged = Json.Obj(Json.Parse(Json.Pretty(receipt)));
                forged["output_sha256"] = "forged";
                using (DeviceKey attacker = DeviceKey.Load(otherRoot)) attacker.Sign(forged);
                Assert(DeviceKey.Verify(forged, out reason), "a re-signed forgery is self-consistent (that alone proves nothing)");
                Assert(!DeviceKey.VerifyTrusted(forged, trustedKeyId, out reason) && reason.StartsWith("key_id "), "a re-signed forgery fails against the trusted key id: " + reason);
                Assert(DeviceKey.VerifyTrusted(roundTrip, trustedKeyId, out reason), "the genuine receipt passes against the trusted key id: " + reason);
                Assert(!DeviceKey.VerifyTrusted(roundTrip, null, out reason), "no trusted key id means no origin verdict");
            }
            finally { try { Directory.Delete(otherRoot, true); } catch (Exception) { } }
        }
        finally { try { Directory.Delete(root, true); } catch (Exception) { } }

        // Number canonicalisation follows ECMAScript Number::toString.
        Assert(Canonical.EcmaNumber(10000000000000000000d) == "10000000000000000000", "1e19 prints in plain digits");
        Assert(Canonical.EcmaNumber(9223372036854775808d) == "9223372036854776000", "2^63 prints as ECMAScript does");
        Assert(Canonical.EcmaNumber(0.000001) == "0.000001" && Canonical.EcmaNumber(0.0000001) == "1e-7", "small numbers switch to exponent form below 1e-6");
        Assert(Canonical.EcmaNumber(0.1 + 0.7) == "0.7999999999999999", "shortest round-trip digits");
        Assert(Canonical.EcmaNumber(1000000000000000.5) == "1000000000000000.5" && Canonical.EcmaNumber(-1.5e300) == "-1.5e+300", "large and negative forms");
        Assert(Canonical.Json(Json.Parse("{\"n\":10000000000000000000,\"m\":-0.0,\"k\":123.45}")) == "{\"k\":123.45,\"m\":0,\"n\":10000000000000000000}", "parsed numbers canonicalise through the same path");
        bool threw = false;
        try { Canonical.EcmaNumber(double.NaN); } catch (ArgumentException) { threw = true; }
        Assert(threw, "NaN is refused");
        Assert(!ContextRefs.FollowsRedirects, "context fetches never follow redirects");

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
        Assert(refusedReceipt.ContainsKey("error") && (bool)refusedReceipt["inference_verified"] == false && Convert.ToString(refusedReceipt["inference_mode"]) == "unknown", "a non-loopback runtime yields an error receipt with mode unknown, never a claim");
        var absent = ExoProbe.RankReceipt("http://127.0.0.1:1", "node_x").Result;
        Assert(absent.ContainsKey("error") && Convert.ToString(absent["inference_mode"]) == "unknown", "an absent runtime yields an error, not single-device");

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

    // The metering block: one shape on both execution paths, raw counters kept apart. The key list below is a
    // copy of the contract's (docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md on branch
    // prime/contribution-ledger; that file is not in this tree, so it cannot be read from here).
    private static void MeteringChecks()
    {
        string[] contract = { "prompt_eval_count", "prompt_eval_cached_count", "eval_count", "total_duration_ns", "load_duration_ns", "prompt_eval_duration_ns", "eval_duration_ns", "model", "model_digest", "runtime_version", "node_id", "node_key_fingerprint", "hardware_mode", "attempt", "duration_ms" };
        Assert(string.Join(",", Metering.Keys) == string.Join(",", contract), "the metering keys are exactly the contract's, in its order");
        object chat = Json.Parse("{\"model\":\"qwen3-vl:4b\",\"done\":true,\"total_duration\":5123456789,\"load_duration\":123456789,\"prompt_eval_count\":120,\"prompt_eval_duration\":400000000,\"eval_count\":256,\"eval_duration\":12800000000,\"message\":{\"role\":\"assistant\",\"content\":\"x\"}}");
        var direct = Metering.FromOllamaChat(chat, "qwen3-vl:4b", "sha256:abc", "0.40.16", null, "key_1", "gpu-verified", 1);
        Assert(string.Join(",", direct.Keys) == string.Join(",", contract), "ollama-direct metering has every contract key and nothing else");
        Assert((long)direct["prompt_eval_count"] == 120 && (long)direct["eval_count"] == 256 && (long)direct["total_duration_ns"] == 5123456789L && (long)direct["load_duration_ns"] == 123456789L && (long)direct["prompt_eval_duration_ns"] == 400000000L && (long)direct["eval_duration_ns"] == 12800000000L, "every raw counter is recorded separately as an integer");
        Assert(direct["prompt_eval_cached_count"] == null, "a counter the runtime did not report is null, never 0 and never summed into another");
        Assert((string)direct["model_digest"] == "sha256:abc" && (string)direct["runtime_version"] == "0.40.16" && direct["node_id"] == null && (string)direct["node_key_fingerprint"] == "key_1" && (string)direct["hardware_mode"] == "gpu-verified" && (int)direct["attempt"] == 1 && direct["duration_ms"] == null, "identity fields and the unset wall clock");
        object usage = Json.Parse("{\"prompt_eval_count\":120,\"prompt_eval_cached_count\":100,\"eval_count\":256,\"total_duration_ns\":5123456789,\"load_duration_ns\":0,\"prompt_eval_duration_ns\":400000000,\"eval_duration_ns\":12800000000,\"prompt_tokens_per_second\":300,\"generation_tokens_per_second\":20}");
        var viaAdapter = Metering.FromAdapterUsage(usage, "qwen3-vl:4b", "sha256:abc", "0.40.16", "node_x", "key_1", "gpu-verified", 2);
        Assert(string.Join(",", viaAdapter.Keys) == string.Join(",", direct.Keys), "the adapter path writes the identical shape");
        Assert((long)viaAdapter["prompt_eval_cached_count"] == 100 && (long)viaAdapter["load_duration_ns"] == 0 && (string)viaAdapter["node_id"] == "node_x" && (int)viaAdapter["attempt"] == 2, "adapter counters are copied as reported (0 stays 0, cached count kept)");
        Assert(!viaAdapter.ContainsKey("prompt_tokens_per_second"), "derived rates never enter the metering block");
        Assert(Metering.Counter(Json.Parse("{\"n\":-5}"), "n") == null && Metering.Counter(Json.Parse("{\"n\":\"x\"}"), "n") == null && (long)Metering.Counter(Json.Parse("{\"n\":7.9}"), "n") == 7, "counters are non-negative integers or null");
        var status = new OllamaStatus();
        status.Models.Add(new OllamaModel { Name = "qwen3-vl:4b", Digest = "sha256:def" });
        Assert(Metering.DigestFor(status, "QWEN3-VL:4B") == "sha256:def" && Metering.DigestFor(status, "other") == null && Metering.DigestFor(null, "x") == null, "the digest is matched by name from the run-time tag list");

        // duration_ms is set when the attempt ends, on a failed attempt as on a successful one.
        var failedReceipt = new Dictionary<string, object>();
        failedReceipt["metering"] = Metering.FromOllamaChat(chat, "qwen3-vl:4b", null, "0.40.16", null, "key_1", "cpu-only", 2);
        Assert(((Dictionary<string, object>)failedReceipt["metering"])["duration_ms"] == null, "duration_ms is null while the attempt runs");
        Assert(!Metering.EndAttempt(failedReceipt, 1, 111) && ((Dictionary<string, object>)failedReceipt["metering"])["duration_ms"] == null, "another attempt's end never closes this attempt's block");
        Assert(Metering.EndAttempt(failedReceipt, 2, 4321) && (long)((Dictionary<string, object>)failedReceipt["metering"])["duration_ms"] == 4321, "ending the attempt (the failure path calls this too) sets duration_ms");
        Assert(!Metering.EndAttempt(new Dictionary<string, object>(), 1, 5) && !Metering.EndAttempt(null, 1, 5), "a receipt without a metering block (inventory, or a failure before the model answered) is left alone");
        string runner = File.ReadAllText(FindSource("LocalJobs.cs"));
        int catchAt = runner.IndexOf("catch (Exception ex)", runner.IndexOf("public async Task<LocalJob> Run("), StringComparison.Ordinal);
        int catchEnd = runner.IndexOf("if (job.State == JobState.Done) break;", catchAt, StringComparison.Ordinal);
        Assert(catchAt > 0 && catchEnd > catchAt && runner.Substring(catchAt, catchEnd - catchAt).Contains("Metering.EndAttempt(job.Receipt, attempt, sw.ElapsedMilliseconds);"), "the runner's failure path closes the metering block with the attempt's wall clock");

        // Node-adapter path: the adapter's own post-generation digest and daemon version win over the desktop's earlier probes.
        object usageWithEvidence = Json.Parse("{\"eval_count\":3,\"model_digest\":\"sha256:served\",\"ollama_version\":\"0.12.9\"}");
        string[] preferred = Metering.AdapterEvidence(usageWithEvidence, "sha256:health-before", "0.40.16");
        Assert(preferred[0] == "sha256:served" && preferred[1] == Metering.DigestFromExecute && preferred[2] == "0.12.9" && preferred[3] == Metering.VersionFromExecute, "usage.model_digest and usage.ollama_version from /execute are preferred");
        string[] older = Metering.AdapterEvidence(usage, "sha256:health-before", "0.40.16");
        Assert(older[0] == "sha256:health-before" && older[1] == Metering.DigestFromHealth && older[2] == "0.40.16" && older[3] == Metering.VersionFromProbe, "an adapter that returns neither falls back to the earlier probes and the source says so");
        string[] nulls = Metering.AdapterEvidence(Json.Parse("{\"model_digest\":null,\"ollama_version\":null}"), null, null);
        Assert(nulls[0] == null && nulls[1] == null && nulls[2] == null && nulls[3] == null, "no reading anywhere is null with no source claimed");
        Assert(Metering.DigestFromExecute.Contains("not atomic") && Metering.DigestFromTags.Contains("AFTER /api/chat") && Metering.DigestFromTags.Contains("not atomic") && Metering.DigestFromHealth.Contains("BEFORE the run"), "each digest source names the exact call and says it is not atomic with the completion");
        Assert(runner.Contains("Metering.AdapterEvidence(usage, implementation.Digest, ollama.Version)") && runner.Contains("evidenceBlock[\"model_digest_source\"] = Metering.DigestFromTags"), "the runner records where the digest came from on both paths");
    }

    // desktop\windows\src\<name>, found from the test executable's folder upward (the build runs the tests from its output folder).
    private static string FindSource(string name)
    {
        string dir = Path.GetDirectoryName(typeof(DesktopTests).Assembly.Location);
        for (int up = 0; up <= 6 && dir != null; up++)
        {
            foreach (string candidate in new[] { Path.Combine(dir, "src", name), Path.Combine(dir, "desktop", "windows", "src", name) })
                if (File.Exists(candidate)) return candidate;
            dir = Path.GetDirectoryName(dir);
        }
        throw new Exception("FAILED: source file not found from the test folder: " + name);
    }

    [System.Runtime.InteropServices.DllImport("shell32.dll", SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string commandLine, out int argc);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    // Windows' own parse of a command line (the rules QuoteArg must satisfy); argv[0] is the program name.
    private static string[] SplitCommandLine(string commandLine)
    {
        int argc;
        IntPtr argv = CommandLineToArgvW(commandLine, out argc);
        if (argv == IntPtr.Zero) throw new Exception("FAILED: CommandLineToArgvW refused: " + commandLine);
        try
        {
            var args = new string[argc];
            for (int i = 0; i < argc; i++) args[i] = System.Runtime.InteropServices.Marshal.PtrToStringUni(System.Runtime.InteropServices.Marshal.ReadIntPtr(argv, i * IntPtr.Size));
            return args;
        }
        finally { LocalFree(argv); }
    }

    // QuoteArg against the Windows command-line rules: trailing backslashes, backslashes before a quote, embedded quotes, empty.
    private static void QuoteArgChecks()
    {
        Assert(Contribution.QuoteArg("C:\\McCluster Node\\") == "\"C:\\McCluster Node\\\\\"", "a trailing backslash before the closing quote is doubled: " + Contribution.QuoteArg("C:\\McCluster Node\\"));
        Assert(Contribution.QuoteArg("D:\\Node Root\\\\") == "\"D:\\Node Root\\\\\\\\\"", "two trailing backslashes become four");
        Assert(Contribution.QuoteArg("C:\\plain\\") == "C:\\plain\\" && Contribution.QuoteArg("C:\\a\\b") == "C:\\a\\b", "a value without a space, tab or quote is passed as it is (backslashes are literal there)");
        Assert(Contribution.QuoteArg("C:\\a dir\\file") == "\"C:\\a dir\\file\"", "backslashes inside a quoted value that precede no quote stay single");
        Assert(Contribution.QuoteArg("say \"hi\"") == "\"say \\\"hi\\\"\"" && Contribution.QuoteArg("a\\\"b") == "\"a\\\\\\\"b\"", "an embedded quote is escaped and the backslashes before it doubled");
        Assert(Contribution.QuoteArg("") == "\"\"" && Contribution.QuoteArg(null) == "\"\"", "an empty value is an explicit empty argument");
        string[] values = { "C:\\McCluster Node\\", "D:\\Node Root\\\\", "C:\\plain\\", "plain", "", "a b", "say \"hi\"", "a\\\"b", "ends with quote\"", "\\\\server\\share name\\", "tab\there\\", "org id with \"quotes\" and \\ slashes \\", "-Extra", "tail" };
        var line = new System.Text.StringBuilder("program.exe");
        foreach (string value in values) line.Append(' ').Append(Contribution.QuoteArg(value));
        string[] parsedBack = SplitCommandLine(line.ToString());
        Assert(parsedBack.Length == values.Length + 1, "Windows splits the quoted line into exactly the arguments given (" + (parsedBack.Length - 1) + " of " + values.Length + ")");
        for (int i = 0; i < values.Length; i++) Assert(parsedBack[i + 1] == values[i], "argument " + i + " round-trips through the Windows command-line parser: [" + values[i] + "] came back as [" + parsedBack[i + 1] + "]");
        // The reviewed failure, end to end: a state root with a space and a trailing backslash keeps the next switch separate.
        var doctorLine = Contribution.CommandLine("C:\\a dir\\doctor.ps1", new List<string> { "-StateRoot", "D:\\Node Root\\", "-Extra", "tail" });
        string[] doctorArgs = SplitCommandLine("powershell.exe " + doctorLine);
        Assert(doctorArgs.Length == 11 && doctorArgs[6] == "C:\\a dir\\doctor.ps1" && doctorArgs[8] == "D:\\Node Root\\" && doctorArgs[9] == "-Extra" && doctorArgs[10] == "tail", "-StateRoot \"D:\\Node Root\\\" no longer swallows the arguments after it");
    }

    // The Contribute panel's logic: consent text, limits, the doctor's switches, the device state, and that the
    // enrolment credential never lands in the job store, the logs or a receipt.
    private static void ContributionChecks()
    {
        foreach (string phrase in new[] { "approved model class", "workload class public", "limits", "no account credential", "no tool permission beyond the executor contract", "Pause and Revoke are one click away", "never silently off" })
            Assert(Contribution.ConsentText.Contains(phrase), "consent text says: " + phrase);
        Assert(!Contribution.ConsentText.Contains("Cluster AI") || Contribution.ConsentText.Contains("McCluster"), "the AI is named McCluster, never Cluster");

        var limits = new Contribution.Limits { IdleOnly = true, OnACOnly = false, MaxConcurrency = 2, CpuBusyPercent = 70, BatteryFloorPercent = 25, ThermalLimitC = 85 };
        limits.Validate();
        List<string> limitArgs = Contribution.DoctorArgs("limits", "C:\\state root", limits, null, null);
        Assert(string.Join(" ", limitArgs) == "-Limits -IdleOnly -MaxConcurrency 2 -CpuBusyPercent 70 -BatteryFloorPercent 25 -ThermalLimitC 85 -StateRoot C:\\state root", "the -Limits switches are explicit: " + string.Join(" ", limitArgs));
        Assert(string.Join(" ", Contribution.DoctorArgs("limits", "S", new Contribution.Limits(), null, null)) == "-Limits -MaxConcurrency 1 -StateRoot S", "default limits pass only -MaxConcurrency 1");
        Assert(string.Join(" ", Contribution.DoctorArgs("pause", "S", null, null, null)) == "-Pause -StateRoot S" && string.Join(" ", Contribution.DoctorArgs("resume", "S", null, null, null)) == "-Resume -StateRoot S" && string.Join(" ", Contribution.DoctorArgs("revoke", "S", null, null, null)) == "-Revoke -StateRoot S", "pause, resume and revoke are one switch each plus the state root");
        Assert(string.Join(" ", Contribution.DoctorArgs("enroll", "S", null, "R", null)) == "-Enroll -RepoPath R -StateRoot S", "enrol names the checkout and the state root, never a token");
        Assert(string.Join(" ", Contribution.DoctorArgs("install", "S", null, "R", "org")) == "-Install -RepoPath R -OrgId org -StateRoot S", "install names the checkout and the org id");
        foreach (var bad in new[] { new Contribution.Limits { MaxConcurrency = 5 }, new Contribution.Limits { CpuBusyPercent = 5 }, new Contribution.Limits { BatteryFloorPercent = 101 }, new Contribution.Limits { ThermalLimitC = -1 } })
        {
            bool refused = false;
            try { bad.Validate(); } catch (ArgumentException) { refused = true; }
            Assert(refused, "an out-of-range limit is refused before the doctor runs");
        }
        bool noRepo = false;
        try { Contribution.DoctorArgs("install", "S", null, null, "org"); } catch (ArgumentException) { noRepo = true; }
        Assert(noRepo, "install without a checkout is refused");
        Assert(limits.Summary(false).Contains("thermal limit 85 C (unsupported on this device") && !limits.Summary(false).Contains(" off)") && limits.Summary(true).EndsWith("thermal limit 85 C") && limits.Summary(null).Contains("support unknown"), "the thermal limit is said as unsupported, never off: " + limits.Summary(false));
        Assert(Contribution.CommandLine("C:\\a dir\\doctor.ps1", limitArgs).StartsWith("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\\a dir\\doctor.ps1\" -Limits") && Contribution.CommandLine("C:\\a dir\\doctor.ps1", limitArgs).EndsWith("-StateRoot \"C:\\state root\""), "the command line is the Bypass -File form with quoted paths");
        Assert(Contribution.RepoRootFromDoctor("C:\\src\\repo\\core\\windows\\mccluster-node.ps1") == "C:\\src\\repo" && Contribution.RepoRootFromDoctor("C:\\apps\\mccluster-node.ps1") == null, "the checkout is derived from the doctor path only when it sits in core\\windows");

        string root = Path.Combine(Path.GetTempPath(), "mccluster-contrib-tests-" + Guid.NewGuid().ToString("N"));
        string stateDir = root + "-state";
        string doctorDir = root + "-doctor";
        try
        {
            // The device state from a throwaway state root (the identity file is only tested for presence).
            Directory.CreateDirectory(stateDir);
            File.WriteAllText(Path.Combine(stateDir, "node.config.json"), "{\"schema\":\"mccluster-node-config/1\",\"node_name\":\"x\",\"tier\":\"C\"}");
            File.WriteAllText(Path.Combine(stateDir, "identity.json"), "{\"nodeId\":\"node_fixture\",\"publicKeyPem\":\"p\",\"privateKeyPem\":\"NEVER-READ\"}");
            File.WriteAllText(Path.Combine(stateDir, "paused"), "2026-11-23T00:00:00Z");
            File.WriteAllText(Path.Combine(stateDir, "limits.json"), "{\"schema\":\"mccluster-node-limits/1\",\"idle_only\":true,\"on_ac_only\":false,\"max_concurrency\":2,\"cpu_busy_percent\":70,\"battery_floor_percent\":0,\"thermal_limit_c\":85}");
            File.WriteAllText(Path.Combine(stateDir, "last-heartbeat.json"), "{\"schema\":\"mccluster-node-heartbeat/1\",\"node_id\":\"node_fixture\",\"at\":\"2026-11-23T01:02:03Z\",\"labels\":{\"thermal_supported\":false,\"claim_gate\":\"paused\"}}");
            var store = new JobStore(root);
            LocalJob done = store.Create(JobKind.Inventory, JobTarget.LocalDevice, new Dictionary<string, object>());
            done.State = JobState.Done; store.Save(done);
            store.Create(JobKind.Inventory, JobTarget.LocalDevice, new Dictionary<string, object>());
            Contribution.State state = Contribution.ReadState(stateDir, store);
            Assert(state.Installed && state.Enrolled && state.Paused, "installed, enrolled and paused are read from the state root");
            Assert(state.Limits != null && state.Limits.IdleOnly && state.Limits.MaxConcurrency == 2 && state.Limits.CpuBusyPercent == 70 && state.Limits.BatteryFloorPercent == 0 && state.Limits.ThermalLimitC == 85 && state.LimitsError == null, "limits.json is read (a battery floor of 0 is a set value)");
            Assert(state.HeartbeatNodeId == "node_fixture" && state.LastHeartbeatAt.HasValue && state.LastHeartbeatAt.Value.Hour == 1 && state.LastHeartbeatAt.Value.Minute == 2 && state.ThermalSupported == false && state.ClaimGate == "paused", "the heartbeat file gives node id, time, thermal support and the claim gate");
            Assert(state.LocalDoneReceipts == 1 && !state.AcceptedWork.HasValue, "accepted work counts local done receipts and says the node file is absent");
            Assert(Contribution.ReportedNodeId(stateDir) == "node_fixture", "the node id for receipts comes from the heartbeat file");
            File.WriteAllText(Path.Combine(stateDir, "limits.json"), "{broken");
            Assert(Contribution.ReadState(stateDir, null).LimitsError == "invalid_json", "a broken limits.json is named, not guessed");
            File.WriteAllText(Path.Combine(stateDir, "limits.json"), "{\"schema\":\"other/1\",\"max_concurrency\":4}");
            Assert(Contribution.ReadState(stateDir, null).LimitsError == "schema_mismatch" && Contribution.ReadState(stateDir, null).Limits == null, "a foreign limits file is named and never widens a limit");
            Directory.CreateDirectory(doctorDir);

            // A fake doctor: proves the credential reaches the child's environment (by length only) and nothing else.
            string fakeDoctor = Path.Combine(doctorDir, "fake-doctor.ps1");
            File.WriteAllText(fakeDoctor,
                "param([switch]$Enroll, [switch]$Pause, [string]$RepoPath, [string]$StateRoot)\n" +
                "$length = 0; if ($env:MCCLUSTER_NODE_ENROLL_TOKEN) { $length = $env:MCCLUSTER_NODE_ENROLL_TOKEN.Length }\n" +
                "[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'token-length.txt'), [string]$length)\n" +
                "Write-Output ('fake doctor ran: Enroll=' + $Enroll + ' Pause=' + $Pause + ' StateRoot=' + $StateRoot)\n" +
                "Write-Error 'fake stderr line'\n" +
                "exit 0\n");
            string sentinel = "SENTINEL-mcen1-" + Guid.NewGuid().ToString("N") + "-NEVER-STORED";
            Contribution.DoctorResult enrol = Contribution.RunDoctor(fakeDoctor, Contribution.DoctorArgs("enroll", stateDir, null, null, null), sentinel, 60000, store).Result;
            Assert(enrol.ExitCode == 0 && !enrol.TimedOut, "the fake doctor ran through powershell.exe -NoProfile -ExecutionPolicy Bypass -File: exit " + enrol.ExitCode + " " + enrol.StdErr);
            Assert(enrol.StdOut.Contains("Enroll=True") && enrol.StdOut.Contains("StateRoot=" + stateDir), "stdout is captured with the explicit switches: " + enrol.StdOut);
            Assert(enrol.StdErr.Contains("fake stderr line"), "stderr is captured too");
            Assert(File.ReadAllText(Path.Combine(doctorDir, "token-length.txt")) == sentinel.Length.ToString(), "the credential reached the child process environment (length only is recorded by the fixture)");
            Assert(!enrol.CommandLine.Contains(sentinel) && !enrol.StdOut.Contains(sentinel), "the credential is on no command line and in no output");
            Contribution.DoctorResult pause = Contribution.RunDoctor(fakeDoctor, Contribution.DoctorArgs("pause", stateDir, null, null, null), null, 60000, store).Result;
            Assert(pause.ExitCode == 0 && pause.StdOut.Contains("Pause=True") && File.ReadAllText(Path.Combine(doctorDir, "token-length.txt")) == "0", "a run without a credential hands the child no token variable at all");
            // A real powershell.exe -File run with a state root that has a space and a trailing backslash:
            // the doctor receives exactly that root, and the switch after it is still its own argument.
            string trailing = "D:\\Node Root\\";
            var trailingArgs = new List<string> { "-StateRoot", trailing, "-Pause" };
            Contribution.DoctorResult trailingRun = Contribution.RunDoctor(fakeDoctor, trailingArgs, null, 60000, store).Result;
            Assert(trailingRun.ExitCode == 0 && trailingRun.StdOut.Contains("Pause=True") && trailingRun.StdOut.Contains("StateRoot=" + trailing) && !trailingRun.StdOut.Contains("StateRoot=" + trailing + "\""), "powershell.exe -File receives a trailing-backslash state root intact and the next switch separately: " + trailingRun.StdOut);

            // A fake local job with a metering block beside the doctor runs: then grep everything the desktop wrote.
            LocalJob job = store.Create(JobKind.Chat, JobTarget.LocalDevice, new Dictionary<string, object> { { "prompt", "hello" }, { "model", "qwen3-vl:4b" } });
            job.Receipt = new Dictionary<string, object>();
            job.Receipt["metering"] = Metering.FromOllamaChat(Json.Parse("{\"eval_count\":3}"), "qwen3-vl:4b", null, "0.40.16", Contribution.ReportedNodeId(stateDir), "key", "cpu-only", 1);
            job.State = JobState.Done;
            store.Save(job);
            store.Log("contribution_enable_started", new Dictionary<string, object> { { "install_needed", false }, { "limits", limits.Summary(null) } });
            int filesScanned = 0;
            foreach (string file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
            {
                filesScanned++;
                Assert(!File.ReadAllText(file).Contains(sentinel), "the enrolment credential never appears in the job store, the logs or a receipt: " + file);
            }
            Assert(filesScanned >= 3 && File.ReadAllText(store.LogPath).Contains("\"event\":\"doctor_run\"") && File.ReadAllText(store.LogPath).Contains("\"action\":\"-Enroll\""), "the log records the doctor run by action and exit code (" + filesScanned + " files scanned)");
        }
        finally
        {
            foreach (string dir in new[] { root, stateDir, doctorDir }) { try { Directory.Delete(dir, true); } catch (Exception) { } }
        }
    }

    // ---- Core (staging): profile rules, the TLS decision, and the client against a labelled fixture ----

    private const string StagingOrg = "11111111-2222-4333-8444-555555555555";

    private static string ProfileJson(string coreUrl, bool? staging, string ca)
    {
        var d = new Dictionary<string, object> { { "core_url", coreUrl }, { "admin_token_file", "admin.token" }, { "org_id", StagingOrg } };
        if (staging.HasValue) d["staging"] = staging.Value;
        if (ca != null) d["ca_cert_path"] = ca;
        return Json.Compact(d);
    }

    // "REFUSED:<code>" for a policy refusal, "ERROR:<code>" for a malformed profile, "OK" when accepted.
    private static string ProfileVerdict(string json)
    {
        try { CoreProfile.Parse(Json.Parse(json), "C:\\nowhere"); return "OK"; }
        catch (CoreProfileException ex) { return (ex.Refused ? "REFUSED:" : "ERROR:") + ex.Code; }
    }

    private static void CoreStagingProfileChecks()
    {
        // Production hosts are refused outright: no staging flag, scheme, port, case or CA changes that.
        foreach (string url in new[] { "https://compute.mccluster.org", "https://core.mccluster.org", "https://COMPUTE.McCluster.org/", "https://core.mccluster.org.:443/", "http://compute.mccluster.org", "https://core.mccluster.org:8443", "https://api.mccluster.org", "https://mccluster.org", "https://zmnhbrjyhxzhkxmhkexs.supabase.co" })
        {
            Assert(ProfileVerdict(ProfileJson(url, true, "ca.pem")) == "REFUSED:PRODUCTION_HOST_REFUSED", "production host refused even with staging=true and a CA: " + url + " -> " + ProfileVerdict(ProfileJson(url, true, "ca.pem")));
            Assert(ProfileVerdict(ProfileJson(url, null, null)) == "REFUSED:PRODUCTION_HOST_REFUSED", "production host refused without a flag: " + url);
        }
        Assert(CoreProfile.IsProductionHost("compute.mccluster.org") && CoreProfile.IsProductionHost("core.mccluster.org") && !CoreProfile.IsProductionHost("staging-core.example.test"), "the production list names the compute and core hosts");
        // By suffix: every host under mccluster.org and humanuprise.com, listed anywhere or not, with or
        // without the staging flag, in any case, with a trailing dot or a port.
        foreach (string url in new[] { "https://matthew.mccluster.org", "https://staging.mccluster.org", "https://staging-core.mccluster.org:8443", "https://a.b.c.mccluster.org", "https://new-thing.MCCLUSTER.ORG.", "https://humanuprise.com", "https://www.humanuprise.com", "https://staging.humanuprise.com:9443", "https://x.y.HumanUprise.com./", "https://db.zmnhbrjyhxzhkxmhkexs.supabase.co" })
        {
            Assert(ProfileVerdict(ProfileJson(url, true, "ca.pem")) == "REFUSED:PRODUCTION_HOST_REFUSED", "a production domain or any subdomain of it is refused even with staging=true and a CA: " + url + " -> " + ProfileVerdict(ProfileJson(url, true, "ca.pem")));
            Assert(ProfileVerdict(ProfileJson(url, null, null)) == "REFUSED:PRODUCTION_HOST_REFUSED", "a production domain or any subdomain of it is refused without a flag: " + url);
        }
        Assert(CoreProfile.IsProductionHost("anything.at.all.mccluster.org") && CoreProfile.IsProductionHost("HUMANUPRISE.COM.") && CoreProfile.IsProductionHost("deep.sub.humanuprise.com") && CoreProfile.IsProductionHost("mccluster.org"), "the production rule is a suffix match on the domain, not a list of names");
        // A suffix match on labels, not on characters: a different registrable name is not production,
        // and then the staging rule decides (refused unless staging=true).
        Assert(!CoreProfile.IsProductionHost("notmccluster.org") && !CoreProfile.IsProductionHost("mccluster.org.example.test") && !CoreProfile.IsProductionHost("myhumanuprise.com") && !CoreProfile.IsProductionHost("127.0.0.1") && !CoreProfile.IsProductionHost(null), "a name that only ends in the same characters, or carries the domain as a prefix, is not the production domain");
        Assert(ProfileVerdict(ProfileJson("https://notmccluster.org", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED" && ProfileVerdict(ProfileJson("https://mccluster.org.example.test", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED" && ProfileVerdict(ProfileJson("https://8.8.8.8", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED" && ProfileVerdict(ProfileJson("https://[2001:db8::1]:8443", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED", "any other host that is not loopback is refused unless staging=true");
        // Not loopback and not marked staging: refused. The flag must be the boolean true.
        Assert(ProfileVerdict(ProfileJson("https://staging-core.example.test", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED", "a non-loopback host without staging=true is refused");
        Assert(ProfileVerdict(ProfileJson("https://staging-core.example.test", false, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED", "staging=false is refused");
        Assert(ProfileVerdict("{\"core_url\":\"https://staging-core.example.test\",\"staging\":\"true\",\"ca_cert_path\":\"ca.pem\",\"admin_token_file\":\"t\",\"org_id\":\"" + StagingOrg + "\"}") == "REFUSED:NOT_STAGING_REFUSED", "the string \"true\" is not the staging flag");
        Assert(ProfileVerdict(ProfileJson("https://127.0.0.1.example.net", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED" && ProfileVerdict(ProfileJson("https://localhost.example.net", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED", "a name that only starts like loopback is not loopback");
        Assert(ProfileVerdict(ProfileJson("https://192.168.1.20:8443", null, "ca.pem")) == "REFUSED:NOT_STAGING_REFUSED", "a LAN address is not loopback");
        // Marked staging: https and the profile's CA are both required off loopback.
        Assert(ProfileVerdict(ProfileJson("https://staging-core.example.test:8443", true, "ca.pem")) == "OK", "a staging=true https host with a CA is accepted");
        Assert(ProfileVerdict(ProfileJson("http://staging-core.example.test", true, "ca.pem")) == "REFUSED:PLAINTEXT_REFUSED", "the token never goes over plain http off this device");
        Assert(ProfileVerdict(ProfileJson("https://staging-core.example.test", true, null)) == "REFUSED:CA_REQUIRED", "https without the profile's CA is refused (the system store is never the fallback)");
        // Loopback.
        foreach (string url in new[] { "http://127.0.0.1:8787", "http://localhost:8787/", "http://[::1]:8787" })
            Assert(ProfileVerdict(ProfileJson(url, null, null)) == "OK", "plain loopback http is accepted: " + url + " -> " + ProfileVerdict(ProfileJson(url, null, null)));
        Assert(ProfileVerdict(ProfileJson("https://127.0.0.1:8443", null, "ca.pem")) == "OK" && ProfileVerdict(ProfileJson("https://127.0.0.1:8443", null, null)) == "REFUSED:CA_REQUIRED", "loopback https needs the profile's CA too");
        // Malformed.
        Assert(ProfileVerdict(ProfileJson("https://user:pw@127.0.0.1:8443", null, "ca.pem")) == "ERROR:PROFILE_INVALID", "credentials in core_url are refused");
        Assert(ProfileVerdict(ProfileJson("http://127.0.0.1:8787/v1/compute?x=1", null, null)) == "ERROR:PROFILE_INVALID" && ProfileVerdict(ProfileJson("ftp://127.0.0.1", null, null)) == "ERROR:PROFILE_INVALID" && ProfileVerdict(ProfileJson("127.0.0.1:8787", null, null)) == "ERROR:PROFILE_INVALID", "core_url must be an http(s) origin only");
        Assert(ProfileVerdict("{\"core_url\":\"http://127.0.0.1:1\",\"admin_token_file\":\"t\",\"org_id\":\"not-a-uuid\"}") == "ERROR:PROFILE_INVALID" && ProfileVerdict("{\"core_url\":\"http://127.0.0.1:1\",\"org_id\":\"" + StagingOrg + "\"}") == "ERROR:PROFILE_INVALID" && ProfileVerdict("[]") == "ERROR:PROFILE_INVALID", "org_id must be a UUID, admin_token_file is required, the profile is an object");
        CoreProfile parsed = CoreProfile.Parse(Json.Parse(ProfileJson("https://Staging-Core.Example.Test:8443/", true, "ca.pem")), "C:\\profile dir");
        Assert(parsed.Host == "staging-core.example.test" && parsed.HostLabel == "staging-core.example.test:8443" && !parsed.Loopback && parsed.Staging && parsed.CaCertPath == "C:\\profile dir\\ca.pem" && parsed.AdminTokenFile == "C:\\profile dir\\admin.token" && parsed.CoreUrl.AbsoluteUri == "https://staging-core.example.test:8443/", "the profile resolves relative paths beside itself and keeps only the origin");
        bool missing = false;
        try { CoreProfile.Load(Path.Combine(Path.GetTempPath(), "mccluster-no-such-profile-" + Guid.NewGuid().ToString("N") + ".json")); }
        catch (CoreProfileException ex) { missing = ex.Code == "PROFILE_NOT_FOUND" && !ex.Refused; }
        Assert(missing, "a missing profile is an error, not a refusal, and nothing is submitted");
        Assert(CoreProfile.DefaultPath().EndsWith("\\McClusterDesktop\\staging\\profile.json"), "the profile lives under %LOCALAPPDATA%\\McClusterDesktop\\staging");
    }

    private static X509Certificate2 MakeCa(string name)
    {
        using (var key = new RSACng(2048))
        {
            var request = new CertificateRequest("CN=" + name, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
            request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
            return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-10), DateTimeOffset.UtcNow.AddDays(30));
        }
    }

    private static X509Certificate2 MakeLeaf(string name, X509Certificate2 issuer, int fromDays, int toDays)
    {
        using (var key = new RSACng(2048))
        {
            var request = new CertificateRequest("CN=" + name, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
            return request.Create(issuer, DateTimeOffset.UtcNow.AddDays(fromDays), DateTimeOffset.UtcNow.AddDays(toDays), Guid.NewGuid().ToByteArray());
        }
    }

    // An intermediate CA under issuer, with its key kept so it can sign a leaf.
    private static X509Certificate2 MakeIntermediate(string name, X509Certificate2 issuer, out RSACng key)
    {
        key = new RSACng(2048);
        var request = new CertificateRequest("CN=" + name, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        return request.Create(issuer, DateTimeOffset.UtcNow.AddDays(-2), DateTimeOffset.UtcNow.AddDays(20), Guid.NewGuid().ToByteArray());
    }

    // A leaf signed by an intermediate; aiaUrl, when given, becomes an Authority Information Access
    // extension naming where the issuer could be downloaded (caIssuers).
    private static X509Certificate2 MakeLeafUnder(string name, X509Certificate2 intermediate, RSACng intermediateKey, string aiaUrl)
    {
        using (var key = new RSACng(2048))
        {
            var request = new CertificateRequest("CN=" + name, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
            if (aiaUrl != null)
            {
                byte[] url = System.Text.Encoding.ASCII.GetBytes(aiaUrl);
                if (url.Length > 100) throw new Exception("FAILED: the test AIA URL is too long for short-form DER");
                var access = new List<byte>(new byte[] { 0x06, 0x08, 0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x02, 0x86, (byte)url.Length }); // caIssuers, then a URI
                access.AddRange(url);
                var description = new List<byte>(new byte[] { 0x30, (byte)access.Count });
                description.AddRange(access);
                var sequence = new List<byte>(new byte[] { 0x30, (byte)description.Count });
                sequence.AddRange(description);
                request.CertificateExtensions.Add(new X509Extension("1.3.6.1.5.5.7.1.1", sequence.ToArray(), false));
            }
            return request.Create(intermediate.SubjectName, X509SignatureGenerator.CreateForRSA(intermediateKey, RSASignaturePadding.Pkcs1), DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(10), Guid.NewGuid().ToByteArray());
        }
    }

    // The chain is built from what the server presented plus the pinned CA, and nothing is fetched: a
    // loopback listener stands where a certificate's AIA extension points and must never be asked.
    private static void CoreStagingTlsChainChecks(X509Certificate2 ca, X509Certificate2 otherCa)
    {
        var listener = new HttpListener();
        int port = 0;
        var random = new Random();
        for (int attempt = 0; ; attempt++)
        {
            port = 54100 + random.Next(0, 800);
            try { listener.Prefixes.Clear(); listener.Prefixes.Add("http://127.0.0.1:" + port + "/"); listener.Start(); break; }
            catch (HttpListenerException) { if (attempt >= 20) throw; }
        }
        int fetches = 0;
        RSACng fetchedKey, presentedKey;
        X509Certificate2 fetchable = MakeIntermediate("mccluster-desktop-test-intermediate-aia", ca, out fetchedKey);
        X509Certificate2 presentedIntermediate = MakeIntermediate("mccluster-desktop-test-intermediate-presented", ca, out presentedKey);
        byte[] fetchableDer = fetchable.RawData;
        var serve = new System.Threading.Thread(delegate()
        {
            while (true)
            {
                HttpListenerContext context;
                try { context = listener.GetContext(); } catch (Exception) { return; }
                System.Threading.Interlocked.Increment(ref fetches);
                try { context.Response.ContentType = "application/pkix-cert"; context.Response.OutputStream.Write(fetchableDer, 0, fetchableDer.Length); context.Response.Close(); } catch (Exception) { }
            }
        });
        serve.IsBackground = true;
        serve.Start();
        try
        {
            string reason;
            string aiaUrl = "http://127.0.0.1:" + port + "/issuer.cer";
            X509Certificate2 aiaLeaf = MakeLeafUnder("127.0.0.1", fetchable, fetchedKey, aiaUrl);
            X509Certificate2 chainLeaf = MakeLeafUnder("127.0.0.1", presentedIntermediate, presentedKey, null);
            var nothing = new X509Certificate2Collection();
            var withFetchable = new X509Certificate2Collection(fetchable);
            var withPresented = new X509Certificate2Collection(presentedIntermediate);

            // The issuer is one download away and was not presented: refused, and nobody was asked.
            Assert(!CoreTls.Validate(aiaLeaf, nothing, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason) && reason != null, "a leaf whose issuer was not presented is refused even though its AIA extension says where to download it: " + reason);
            Assert(!CoreTls.Validate(aiaLeaf, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "the same through the overload with no presented chain: " + reason);
            Assert(System.Threading.Thread.VolatileRead(ref fetches) == 0, "the chain build made no AIA network fetch (" + fetches + " requests reached the listener the certificate names)");
            // Presented intermediates are the extra material, and only they.
            Assert(!CoreTls.Validate(chainLeaf, nothing, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "a leaf under an intermediate is refused when the intermediate was not presented: " + reason);
            Assert(!CoreTls.Validate(chainLeaf, withFetchable, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "presenting some other intermediate does not help: " + reason);
            Assert(CoreTls.Validate(chainLeaf, withPresented, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "the presented intermediate is used: leaf, intermediate, pinned CA is accepted: " + reason);
            Assert(CoreTls.Validate(aiaLeaf, withFetchable, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "a leaf with an AIA extension is accepted when its intermediate was presented: " + reason);
            Assert(!CoreTls.Validate(chainLeaf, withPresented, SslPolicyErrors.RemoteCertificateChainErrors, otherCa, "127.0.0.1", "127.0.0.1", out reason) && reason != null, "the same chain is refused when the profile pins another CA: " + reason);
            Assert(!CoreTls.Validate(chainLeaf, new X509Certificate2Collection(new[] { presentedIntermediate, ca }), SslPolicyErrors.RemoteCertificateChainErrors, otherCa, "127.0.0.1", "127.0.0.1", out reason) && reason == "the certificate does not chain to the profile's CA", "a complete presented chain that ends at another root is refused: the end must be the pinned CA byte for byte: " + reason);
            // A presented copy of some other root cannot stand in for the pin.
            Assert(!CoreTls.Validate(MakeLeaf("127.0.0.1", otherCa, -1, 10), new X509Certificate2Collection(otherCa), SslPolicyErrors.None, ca, "127.0.0.1", "127.0.0.1", out reason), "presenting another root alongside the leaf is refused: " + reason);
            Assert(System.Threading.Thread.VolatileRead(ref fetches) == 0, "no validation above made a network fetch (" + fetches + ")");
            // What the callback hands over: the framework's chain elements and its extra store.
            using (var framework = new X509Chain())
            {
                framework.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                framework.ChainPolicy.ExtraStore.Add(presentedIntermediate);
                X509Certificate2Collection gathered = CoreTls.Presented(framework);
                bool found = false;
                foreach (X509Certificate2 c in gathered) if (c.Thumbprint == presentedIntermediate.Thumbprint) found = true;
                Assert(found && CoreTls.Presented(null).Count == 0 && CoreTls.Validate(chainLeaf, gathered, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "the certificates the handshake carried are taken from the callback's chain");
            }
        }
        finally
        {
            try { listener.Stop(); listener.Close(); } catch (Exception) { }
            serve.Join(2000);
            fetchedKey.Dispose();
            presentedKey.Dispose();
        }
        string source = File.ReadAllText(FindSource("CoreJobs.cs"));
        Assert(CoreTls.OfflineChainFlags == 0x2004u && source.Contains("OfflineChainFlags = CertChainDisableAia | CertChainCacheOnlyUrlRetrieval;") && source.Contains("ref para, OfflineChainFlags,") && !source.Contains("chain.Build(") && !source.Contains("new X509Chain()"), "the chain is built with AIA retrieval disabled, cache-only URL retrieval and no revocation flag, and by no other path");
        Assert(source.Contains("CoreTls.Validate(certificate, CoreTls.Presented(chain), errors, ca,"), "the request's callback passes the presented chain to the decision");
    }

    // The certificate decision, at the callback level. Every certificate here is generated in memory for
    // this run (test material, never written, never installed); no socket is opened.
    private static void CoreStagingTlsChecks()
    {
        X509Certificate2 ca = MakeCa("mccluster-desktop-test-ca");
        X509Certificate2 otherCa = MakeCa("mccluster-desktop-test-other-ca");
        X509Certificate2 leaf = MakeLeaf("127.0.0.1", ca, -1, 10);
        X509Certificate2 strangerLeaf = MakeLeaf("127.0.0.1", otherCa, -1, 10);
        X509Certificate2 expiredLeaf = MakeLeaf("127.0.0.1", ca, -5, -2);
        string reason;
        Assert(CoreTls.Validate(leaf, SslPolicyErrors.None, ca, "127.0.0.1", "127.0.0.1", out reason), "a certificate issued by the profile's CA for the profile's host is accepted: " + reason);
        Assert(CoreTls.Validate(leaf, SslPolicyErrors.RemoteCertificateChainErrors, ca, "127.0.0.1", "127.0.0.1", out reason), "the system store's distrust of a private CA does not matter; the pin decides: " + reason);
        Assert(CoreTls.Validate(ca, SslPolicyErrors.RemoteCertificateChainErrors, ca, "staging-core.example.test", "staging-core.example.test", out reason), "a self-signed ingress certificate that IS the pinned certificate is accepted: " + reason);
        Assert(!CoreTls.Validate(strangerLeaf, SslPolicyErrors.None, ca, "127.0.0.1", "127.0.0.1", out reason) && reason != null, "a certificate from any other CA is refused, even one the system reports no error for: " + reason);
        Assert(!CoreTls.Validate(otherCa, SslPolicyErrors.None, ca, "127.0.0.1", "127.0.0.1", out reason) && reason == "the certificate does not chain to the profile's CA", "a different self-signed certificate is refused: " + reason);
        Assert(!CoreTls.Validate(leaf, SslPolicyErrors.None, otherCa, "127.0.0.1", "127.0.0.1", out reason), "the same certificate is refused when the profile pins another CA: " + reason);
        Assert(!CoreTls.Validate(leaf, SslPolicyErrors.RemoteCertificateNameMismatch, ca, "127.0.0.1", "127.0.0.1", out reason) && reason.Contains("does not name"), "a name mismatch is refused even under the right CA: " + reason);
        Assert(!CoreTls.Validate(leaf, SslPolicyErrors.None, ca, "other.example.test", "127.0.0.1", out reason) && reason.Contains("request host"), "the pinned CA vouches for the profile's host only: " + reason);
        Assert(!CoreTls.Validate(expiredLeaf, SslPolicyErrors.None, ca, "127.0.0.1", "127.0.0.1", out reason) && reason.Contains("NotTimeValid"), "an expired certificate is refused under the right CA: " + reason);
        Assert(!CoreTls.Validate(leaf, SslPolicyErrors.None, null, "127.0.0.1", "127.0.0.1", out reason) && !CoreTls.Validate(null, SslPolicyErrors.RemoteCertificateNotAvailable, ca, "127.0.0.1", "127.0.0.1", out reason), "no pinned CA or no server certificate is a refusal");
        CoreStagingTlsChainChecks(ca, otherCa);
        // The CA file may be DER or PEM; only the certificate block is read.
        string dashes = new string('-', 5);
        string pem = dashes + "BEGIN CERTIFICATE" + dashes + "\n" + Convert.ToBase64String(ca.RawData, Base64FormattingOptions.InsertLineBreaks) + "\n" + dashes + "END CERTIFICATE" + dashes + "\n";
        Assert(new X509Certificate2(CoreTls.CertificateBytes(System.Text.Encoding.ASCII.GetBytes(pem))).Thumbprint == ca.Thumbprint && new X509Certificate2(CoreTls.CertificateBytes(ca.RawData)).Thumbprint == ca.Thumbprint, "the CA is read from PEM or DER");
        // Per request, never global, never a store: held against the source.
        string source = File.ReadAllText(FindSource("CoreJobs.cs"));
        Assert(source.Contains("request.ServerCertificateValidationCallback = delegate") && !source.Contains("ServicePointManager.ServerCertificateValidationCallback") && !source.Contains("X509Store") && !source.Contains("DangerousAcceptAnyServerCertificateValidator"), "the pin is this request's own callback: no global override and no certificate store");
        Assert(source.Contains("request.AllowAutoRedirect = false;") && source.Contains("request.Proxy = null;"), "the token follows no redirect and goes through no proxy");
    }

    // FIXTURE, NOT A CORE: an in-process HttpListener on plain loopback HTTP that answers the contract's
    // routes in the contract's shapes. It exercises the desktop client's requests and bookkeeping only.
    // No device, no model and no signature is behind it: nothing it returns is hardware proof, and its
    // output says "fixture": true so the client's own summary labels it.
    private sealed class CoreFixture : IDisposable
    {
        private readonly HttpListener listener = new HttpListener();
        private readonly System.Threading.Thread thread;
        public readonly int Port;
        public readonly string Token;
        public readonly string JobId = Guid.NewGuid().ToString();
        public string Mode = "accept"; // accept | refuse | tamper | fail | stuck | force
        // The receipt's signature block and the published key are labelled fixture text, not key material:
        // the desktop only checks that they are present and name the same key id, never that they verify.
        public const string KeyId = "fixture-key-0001";
        public bool Signed = true;         // false: the receipt says signed=false and carries no signature
        public bool SignatureValue = true; // false: signed=true but the signature has no value
        public bool PublishKey = true;     // false: /receipt-key answers "not configured"
        public bool ReceiptInputHash = true, ReceiptOutputHash = true;
        public int ForceStatus;            // Mode "force": the submit answer's status,
        public string ForceCode;           // its code (null: none),
        public bool ForceHtml;             // or an HTML page, as a gateway in front of the Core would send
        public readonly List<string> IdempotencyKeys = new List<string>();
        public readonly List<string> Paths = new List<string>();
        public int Authorized, Unauthorized, StatusReads, Submissions;
        private object submittedInput;
        private string implementation;

        public CoreFixture(string token)
        {
            Token = token;
            var random = new Random();
            for (int attempt = 0; ; attempt++)
            {
                Port = 53100 + random.Next(0, 800);
                try { listener.Prefixes.Clear(); listener.Prefixes.Add("http://127.0.0.1:" + Port + "/"); listener.Start(); break; }
                catch (HttpListenerException) { if (attempt >= 20) throw; }
            }
            thread = new System.Threading.Thread(Serve);
            thread.IsBackground = true;
            thread.Start();
        }

        private void Serve()
        {
            while (true)
            {
                HttpListenerContext context;
                try { context = listener.GetContext(); } catch (Exception) { return; }
                try { Handle(context); } catch (Exception) { try { context.Response.Abort(); } catch (Exception) { } }
            }
        }

        private static void Reply(HttpListenerContext context, int status, Dictionary<string, object> body)
        {
            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(Json.Compact(body));
            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json";
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }

        private Dictionary<string, object> Output(bool altered)
        {
            return new Dictionary<string, object> {
                { "fixture", true }, { "model", "fixture-model:0" }, { "implementation", implementation }, { "content", altered ? "an answer changed after the receipt was issued" : "fixture answer" }, { "done_reason", "stop" },
                { "usage", new Dictionary<string, object> { { "eval_count", 3 }, { "total_duration_ns", 5123456789L }, { "model_digest", "sha256:fixture-digest" }, { "ollama_version", "0.0.0-fixture" } } } };
        }

        private Dictionary<string, object> Node()
        {
            return new Dictionary<string, object> { { "node_id", "node_fixture_0001" }, { "display_name", "Fixture Node (no hardware)" }, { "platform", "fixture-os" }, { "hardware_mode", "cpu-only" }, { "key_fingerprint", "fixture-fingerprint" } };
        }

        private Dictionary<string, object> JobView(string status)
        {
            bool terminal = status == "done" || status == "failed";
            return new Dictionary<string, object> {
                { "schema", "mccluster-job/1" }, { "job_id", JobId }, { "org_id", StagingOrg }, { "capability", "ai.chat" }, { "implementation", implementation }, { "status", status }, { "terminal", terminal },
                { "attempts", status == "queued" ? 0 : 1 }, { "max_attempts", 3 }, { "last_error", status == "failed" ? "fixture executor failure" : null },
                { "execution", status == "queued" ? null : new Dictionary<string, object> { { "node_id", "node_fixture_0001" }, { "attempt", 1 }, { "status", status } } },
                { "node", status == "queued" ? null : Node() }, { "result_available", status == "done" }, { "receipt_available", terminal } };
        }

        private void Handle(HttpListenerContext context)
        {
            string auth = context.Request.Headers["Authorization"];
            string path = context.Request.Url.AbsolutePath;
            string method = context.Request.HttpMethod;
            lock (Paths) Paths.Add(method + " " + path);
            if (auth != "Bearer " + Token)
            {
                Unauthorized++;
                Reply(context, 401, new Dictionary<string, object> { { "error", "Unauthorized" }, { "code", "UNAUTHORIZED" } });
                return;
            }
            Authorized++;
            if (path == "/v1/compute/receipt-key" && method == "GET")
            {
                Reply(context, 200, new Dictionary<string, object> { { "schema", "mccluster-receipt-key/1" }, { "configured", PublishKey }, { "alg", "ed25519" }, { "key_id", PublishKey ? KeyId : null }, { "public_key_pem", PublishKey ? "FIXTURE PUBLIC KEY TEXT (not a key; nothing here verifies with it)" : null } });
                return;
            }
            if (path == "/v1/compute/jobs" && method == "POST")
            {
                Submissions++;
                string text;
                using (var reader = new StreamReader(context.Request.InputStream, System.Text.Encoding.UTF8)) text = reader.ReadToEnd();
                object body = Json.Parse(text);
                lock (IdempotencyKeys) IdempotencyKeys.Add(context.Request.Headers["Idempotency-Key"]);
                if (Json.Str(body, "org_id") != StagingOrg) { Reply(context, 403, new Dictionary<string, object> { { "error", "Cross-organization job submission is not allowed" }, { "code", "CROSS_ORG_DENIED" } }); return; }
                if (Mode == "refuse")
                {
                    // A hostile or careless server echoing the caller's own header back: the client must redact it.
                    Reply(context, 503, new Dictionary<string, object> { { "error", "No live node advertises ai.chat (fixture echo: " + auth + ")" }, { "code", "COMPUTE_NO_LIVE_NODE" }, { "retryable", true }, { "echo", new Dictionary<string, object> { { "authorization", auth } } } });
                    return;
                }
                if (Mode == "force")
                {
                    if (ForceHtml)
                    {
                        byte[] page = System.Text.Encoding.UTF8.GetBytes("<html><body><h1>" + ForceStatus + " from a gateway</h1></body></html>");
                        context.Response.StatusCode = ForceStatus;
                        context.Response.ContentType = "text/html";
                        context.Response.OutputStream.Write(page, 0, page.Length);
                        context.Response.Close();
                        return;
                    }
                    var forced = new Dictionary<string, object> { { "error", "fixture answer with status " + ForceStatus } };
                    if (ForceCode != null) forced["code"] = ForceCode;
                    Reply(context, ForceStatus, forced);
                    return;
                }
                submittedInput = Json.Get(body, "input");
                implementation = Json.Str(body, "implementation");
                Reply(context, 202, new Dictionary<string, object> { { "schema", "mccluster-job/1" }, { "job", JobView("queued") }, { "replayed", false }, { "live_nodes", 1 } });
                return;
            }
            string prefix = "/v1/compute/jobs/" + JobId;
            if (method != "GET" || !path.StartsWith(prefix, StringComparison.Ordinal)) { Reply(context, 404, new Dictionary<string, object> { { "error", "compute job not found" }, { "code", "JOB_NOT_FOUND" } }); return; }
            if (context.Request.QueryString["org_id"] != StagingOrg) { Reply(context, 400, new Dictionary<string, object> { { "error", "org_id is required" }, { "code", "ORG_REQUIRED" } }); return; }
            string view = path.Substring(prefix.Length);
            string final = Mode == "fail" ? "failed" : "done";
            if (view == "")
            {
                StatusReads++;
                Reply(context, 200, JobView(Mode == "stuck" || StatusReads == 1 ? "running" : final));
                return;
            }
            string genuineHash = Canonical.Sha256Hex(Canonical.Json(Output(false)));
            if (view == "/result")
            {
                Reply(context, 200, new Dictionary<string, object> { { "schema", "mccluster-job-result/1" }, { "job_id", JobId }, { "status", "done" }, { "implementation", implementation }, { "output", Output(Mode == "tamper") }, { "output_sha256", genuineHash }, { "attempt", 1 }, { "node", Node() } });
                return;
            }
            if (view == "/receipt")
            {
                bool done = final == "done";
                Reply(context, 200, new Dictionary<string, object> {
                    { "schema", "mccluster-job-receipt/1" }, { "issued_at", "2026-11-24T00:00:00.000Z" }, { "issuer", new Dictionary<string, object> { { "kind", "mccluster-core" }, { "instance", "desktop-test-fixture" } } },
                    { "job", new Dictionary<string, object> { { "id", JobId }, { "org_id", StagingOrg }, { "capability", "ai.chat" }, { "implementation", implementation }, { "status", final }, { "attempts", 1 }, { "max_attempts", 3 } } },
                    { "input_sha256", ReceiptInputHash ? Canonical.Sha256Hex(Canonical.Json(submittedInput)) : null }, { "output_sha256", done && ReceiptOutputHash ? genuineHash : null },
                    { "failure", done ? null : new Dictionary<string, object> { { "last_error", "fixture executor failure" }, { "attempts", 1 } } },
                    { "execution", new Dictionary<string, object> { { "lease_id", Guid.NewGuid().ToString() }, { "attempt", 1 }, { "status", final }, { "node_id", "node_fixture_0001" }, { "node_key_fingerprint", "fixture-fingerprint" }, { "node_display_name", "Fixture Node (no hardware)" }, { "hardware_mode", "cpu-only" }, { "platform", "fixture-os" }, { "started_at", "2026-11-24T00:00:00.000Z" }, { "completed_at", "2026-11-24T00:00:00.012Z" }, { "duration_ms", 12 } } },
                    { "inference", new Dictionary<string, object> { { "mode", "single-device" }, { "devices", new[] { "node_fixture_0001" } }, { "group", null } } },
                    { "node_attestation", new Dictionary<string, object> { { "node_id", "node_fixture_0001" }, { "verified", true }, { "matches_output", done ? (object)true : null } } }, { "signed", Signed },
                    { "signature", Signed ? new Dictionary<string, object> { { "alg", "ed25519" }, { "key_id", KeyId }, { "value", SignatureValue ? "fixture-signature-text-not-a-signature" : null }, { "covers", "nothing: fixture" } } : null } });
                return;
            }
            Reply(context, 404, new Dictionary<string, object> { { "error", "not found" }, { "code", "JOB_NOT_FOUND" } });
        }

        public void Dispose()
        {
            try { listener.Stop(); listener.Close(); } catch (Exception) { }
            thread.Join(2000);
        }
    }

    // The client and the headless document, against the fixture above over plain loopback HTTP (the
    // profile rules allow exactly that). TLS is not exercised here; CoreStagingTlsChecks holds the pin.
    private static void CoreStagingClientChecks()
    {
        string root = Path.Combine(Path.GetTempPath(), "mccluster-core-staging-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        // Built at run time; it stands for the admin token and must appear in nothing the desktop writes.
        string sentinel = "SENTINEL-admin-" + Guid.NewGuid().ToString("N") + "-NEVER-WRITTEN";
        string tokenDir = root + "-secret";
        Directory.CreateDirectory(tokenDir);
        string tokenFile = Path.Combine(tokenDir, "admin.token");
        File.WriteAllText(tokenFile, sentinel + "\r\n");
        var none = System.Threading.CancellationToken.None;
        try
        {
            var store = new JobStore(root);
            using (var fixture = new CoreFixture(sentinel))
            {
                string profilePath = Path.Combine(root, "profile.json");
                File.WriteAllText(profilePath, Json.Compact(new Dictionary<string, object> { { "core_url", "http://127.0.0.1:" + fixture.Port }, { "admin_token_file", tokenFile }, { "org_id", StagingOrg } }));

                // 1. Accepted, run, read back: the document's shape and the checks the desktop can make.
                string outFile = Path.Combine(root, "core-submit.json");
                Dictionary<string, object> done = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, false, outFile, store, none, 20);
                File.WriteAllText(outFile, Json.Pretty(done));
                Assert((string)done["state"] == "done" && CoreSubmit.ExitCode(done) == 0, "fixture job runs to done with the desktop checks passed: " + done["state"] + " " + done["error"]);
                foreach (string key in new[] { "job", "result", "receipt", "device", "attempts", "timings", "core_url_host", "verification" })
                    Assert(done.ContainsKey(key) && done[key] != null, "the document carries " + key);
                Assert((string)done["core_url_host"] == "127.0.0.1:" + fixture.Port, "core_url_host is host and port only");
                var device = (Dictionary<string, object>)done["device"];
                Assert((string)device["node_id"] == "node_fixture_0001" && (string)device["node_display_name"] == "Fixture Node (no hardware)" && (string)device["platform"] == "fixture-os" && (string)device["hardware_mode"] == "cpu-only" && (string)device["implementation"] == "fixture.echo.local" && (string)device["model"] == "fixture-model:0" && (string)device["model_digest"] == "sha256:fixture-digest" && (string)device["runtime_version"] == "0.0.0-fixture", "device names node, display name, platform, hardware_mode, implementation, model, digest and runtime version");
                Assert((bool)device["output_marked_fixture"], "a fixture executor's output is flagged, so it can never read as hardware proof");
                var verification = (Dictionary<string, object>)done["verification"];
                Assert((bool)verification["receipt_schema_ok"] && (bool)verification["job_id_matches"] && (bool?)verification["output_hash_matches"] == true && (bool?)verification["result_hash_field_matches"] == true && (bool?)verification["input_hash_matches"] == true && (bool)verification["receipt_names_device"] && (bool)verification["desktop_checks_passed"], "schema, job id, output hash, input hash and device are checked and pass");
                Assert((bool)verification["receipt_signature_checked"] == false && ((string)verification["receipt_signature_reason"]).Contains("no Ed25519") && ((string)verification["receipt_signature_verify_command"]).StartsWith("node --input-type=module -e ") && ((string)verification["receipt_signature_verify_command"]).Contains("verifyReceipt") && ((string)verification["receipt_signature_verify_command"]).Contains("./core/src/compute/jobs.mjs") && ((string)verification["receipt_signature_verify_command"]).EndsWith(" \"<path to core-submit.json>\""), "the Core signature is recorded as NOT checked, with the reason and the exact node command, which names the output file and not where it is");
                Assert((bool)verification["receipt_signature_present"] && (bool)verification["receipt_key_present"] && (bool?)verification["receipt_key_id_equals_published_key_id"] == true && ((List<object>)verification["desktop_checks_failed"]).Count == 0, "done needs signed=true with a signature and key id, the receipt key, and both hashes present and matching; all are here");
                object attestationCopy = verification["node_attestation_as_reported_by_core"];
                Assert(Json.Get(attestationCopy, "core_reports_verified") is bool && (bool)Json.Get(attestationCopy, "core_reports_verified") && Json.Obj(attestationCopy) != null && !Json.Obj(attestationCopy).ContainsKey("verified") && (bool)Json.Get(attestationCopy, "checked_by_desktop") == false, "the Core's statement about the node attestation is copied as core_reports_verified; no field named verified exists");
                string doneText = Json.Pretty(done);
                Assert(!doneText.Contains(root) && !doneText.Contains(root.Replace("\\", "\\\\")) && !doneText.Contains(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).Replace("\\", "\\\\")), "the document carries no absolute local path (the --out path was given as one)");
                Assert((bool)verification["receipt_claims_signed"] && ((string)verification["sentence"]).Contains("NOT checked here") && ((string)verification["sentence"]).Contains("the receipt says signed") && ((string)verification["sentence"]).EndsWith("Desktop checks passed; signature unverified.") && !done.ContainsKey("verified") && !verification.ContainsKey("verified") && !Json.Compact(verification).Contains("\"verified\""), "no field claims the receipt verified; the sentence says what was not checked");
                var attempts = (Dictionary<string, object>)done["attempts"];
                var timings = (Dictionary<string, object>)done["timings"];
                Assert((int)attempts["submit_requests"] == 1 && (int)attempts["status_polls"] == 2 && Convert.ToInt32(attempts["job_attempts"]) == 1 && Convert.ToInt32(attempts["lease_attempt"]) == 1 && Convert.ToInt32(attempts["max_attempts"]) == 3, "attempts: one submit request, two bounded polls, the Core's job and lease attempt");
                Assert(Convert.ToInt32(timings["core_duration_ms"]) == 12 && timings["submitted_at"] != null && timings["terminal_at"] != null && (long)timings["total_ms"] >= (long)timings["wait_ms"] && ((List<object>)timings["status_transitions"]).Count == 2, "timings: the Core's lease clock, the desktop's wall clock and each status change");
                Assert(fixture.Submissions == 1 && fixture.IdempotencyKeys.Count == 1 && System.Text.RegularExpressions.Regex.IsMatch(fixture.IdempotencyKeys[0] ?? "", "^[!-~]{1,128}$") && fixture.IdempotencyKeys[0] == Json.Str(done["submitted"], "idempotency_key"), "the job was posted once with an Idempotency-Key in the contract's alphabet");
                Assert(fixture.Authorized == 6 && fixture.Unauthorized == 0, "every request carried the token from the token file as a bearer header (" + fixture.Authorized + " authorized)");
                string summary = CoreSubmit.Summary(done);
                Assert(summary.Contains("Device: Fixture Node (no hardware) · node_fixture_0001 · fixture-os") && summary.Contains("Model: fixture-model:0 · digest sha256:fixture-digest") && summary.Contains("Compute mode (hardware_mode): cpu-only · FIXTURE EXECUTOR OUTPUT: not hardware proof") && summary.Contains("Attempts: job 1 of 3 · lease attempt 1") && summary.Contains("Timing: on the device 12 ms") && summary.Contains("Core signature (ed25519, the receipt says signed): NOT checked here"), "the panel's lines name device, model and digest, compute mode, attempts, timing and the honest verdict:\n" + summary);

                // 2. A result that no longer hashes to what the receipt commits to.
                fixture.Mode = "tamper"; fixture.StatusReads = 0;
                Dictionary<string, object> tampered = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, false, null, store, none, 20);
                File.WriteAllText(Path.Combine(root, "core-submit-tampered.json"), Json.Pretty(tampered));
                var tamperedVerification = (Dictionary<string, object>)tampered["verification"];
                Assert(((string)tampered["error"]).Contains("does not hash to the receipt's output hash"), "the tampered run names its reason: " + tampered["error"]);
                Assert((string)tampered["state"] == "done_unverified" && CoreSubmit.ExitCode(tampered) == 1 && (bool?)tamperedVerification["output_hash_matches"] == false && (bool?)tamperedVerification["result_hash_field_matches"] == false && !(bool)tamperedVerification["desktop_checks_passed"] && ((string)tamperedVerification["sentence"]).Contains("output hash MISMATCH") && ((string)tamperedVerification["sentence"]).Contains("Desktop checks did NOT pass"), "an output that does not hash to the receipt's output_sha256 fails the run: " + tampered["state"]);

                // 2b. A done job whose receipt lacks what the desktop needs is done_unverified, never done:
                // unsigned, a signature without a value, no receipt key, no input hash, no output hash.
                Func<string, Dictionary<string, object>> unverifiedRun = delegate(string file)
                {
                    fixture.Mode = "accept"; fixture.StatusReads = 0;
                    Dictionary<string, object> run = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, false, null, store, none, 20);
                    File.WriteAllText(Path.Combine(root, file), Json.Pretty(run));
                    fixture.Signed = true; fixture.SignatureValue = true; fixture.PublishKey = true; fixture.ReceiptInputHash = true; fixture.ReceiptOutputHash = true;
                    return run;
                };
                fixture.Signed = false;
                Dictionary<string, object> unsigned = unverifiedRun("core-submit-unsigned.json");
                var unsignedVerification = (Dictionary<string, object>)unsigned["verification"];
                string unsignedReasons = string.Join("; ", (List<object>)unsignedVerification["desktop_checks_failed"]);
                Assert((string)unsigned["state"] == "done_unverified" && CoreSubmit.ExitCode(unsigned) == 1 && !(bool)unsignedVerification["desktop_checks_passed"] && !(bool)unsignedVerification["receipt_claims_signed"] && !(bool)unsignedVerification["receipt_signature_present"] && unsignedReasons.Contains("does not say signed=true") && unsignedReasons.Contains("carries no signature value") && unsignedReasons.Contains("names no key id") && ((string)unsigned["error"]).Contains("does not say signed=true"), "an unsigned receipt is done_unverified with the reasons and exit 1, though every hash matches: " + unsigned["state"] + " " + unsignedReasons);
                Assert((bool?)unsignedVerification["output_hash_matches"] == true && (bool?)unsignedVerification["input_hash_matches"] == true && ((string)unsignedVerification["sentence"]).Contains("the receipt says UNSIGNED") && ((string)unsignedVerification["sentence"]).Contains("signature MISSING") && CoreSubmit.Summary(unsigned).Contains("Core signature (none, the receipt says UNSIGNED): NOT checked here") && CoreSubmit.Summary(unsigned).Contains("Desktop checks did NOT pass: "), "the sentence and the panel say the receipt is unsigned and that the checks did not pass");
                fixture.SignatureValue = false;
                Dictionary<string, object> valueless = unverifiedRun("core-submit-no-signature-value.json");
                Assert((string)valueless["state"] == "done_unverified" && CoreSubmit.ExitCode(valueless) == 1 && ((string)valueless["error"]).Contains("carries no signature value") && !((string)valueless["error"]).Contains("signed=true"), "signed=true without a signature value is done_unverified: " + valueless["error"]);
                fixture.PublishKey = false;
                Dictionary<string, object> keyless = unverifiedRun("core-submit-no-receipt-key.json");
                Assert((string)keyless["state"] == "done_unverified" && CoreSubmit.ExitCode(keyless) == 1 && !(bool)((Dictionary<string, object>)keyless["verification"])["receipt_key_present"] && ((string)keyless["error"]).Contains("no receipt key"), "a Core that publishes no receipt key leaves the run done_unverified: " + keyless["error"]);
                fixture.ReceiptInputHash = false;
                Dictionary<string, object> noInputHash = unverifiedRun("core-submit-no-input-hash.json");
                Assert((string)noInputHash["state"] == "done_unverified" && CoreSubmit.ExitCode(noInputHash) == 1 && ((Dictionary<string, object>)noInputHash["verification"])["input_hash_matches"] == null && ((string)noInputHash["error"]).Contains("carries no input hash"), "a receipt without an input hash is a failed check, not a pass by absence: " + noInputHash["error"]);
                fixture.ReceiptOutputHash = false;
                Dictionary<string, object> noOutputHash = unverifiedRun("core-submit-no-output-hash.json");
                Assert((string)noOutputHash["state"] == "done_unverified" && CoreSubmit.ExitCode(noOutputHash) == 1 && ((Dictionary<string, object>)noOutputHash["verification"])["output_hash_matches"] == null && ((string)noOutputHash["error"]).Contains("carries no output hash"), "a receipt without an output hash is a failed check, not a pass by absence: " + noOutputHash["error"]);

                // 3. A job the Core reports failed: no output hash to check, and it is not a pass.
                fixture.Mode = "fail"; fixture.StatusReads = 0;
                Dictionary<string, object> failed = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, false, null, store, none, 20);
                File.WriteAllText(Path.Combine(root, "core-submit-failed.json"), Json.Pretty(failed));
                var failedVerification = (Dictionary<string, object>)failed["verification"];
                Assert((string)failed["state"] == "job_failed" && CoreSubmit.ExitCode(failed) == 1 && failed["result"] == null && failedVerification["output_hash_matches"] == null && !(bool)failedVerification["desktop_checks_passed"] && ((string)failed["error"]).Contains("fixture executor failure"), "a failed job is recorded as failed with the Core's error, its output hash 'not checkable', never a pass");

                // 4. Refusal by the Core, recorded; the server's echo of the header is redacted.
                fixture.Mode = "refuse";
                Dictionary<string, object> refused = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, true, null, store, none, 20);
                File.WriteAllText(Path.Combine(root, "core-submit-refused.json"), Json.Pretty(refused));
                object refusal = refused["refusal"];
                Assert((string)refused["state"] == "refused_as_expected" && CoreSubmit.ExitCode(refused) == 0 && Json.Str(refusal, "code") == "COMPUTE_NO_LIVE_NODE" && Convert.ToInt32(Json.Get(refusal, "http_status")) == 503 && Json.Str(refusal, "stage") == "submit" && Json.Str(refusal, "refused_by") == "core" && (bool)Json.Get(refusal, "retryable") && refused["job"] == null && refused["receipt"] == null, "--expect-refusal records the Core's refusal (code, status, stage) and exits 0");
                Assert(Json.Str(refusal, "error").Contains("[redacted]") && !Json.Str(refusal, "error").Contains(sentinel), "a token the server echoes back is redacted before anything is kept");
                Dictionary<string, object> unexpected = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, false, null, store, none, 20);
                Assert((string)unexpected["state"] == "refused" && CoreSubmit.ExitCode(unexpected) == 1 && CoreSubmit.Summary(unexpected).Contains("Refused by core at submit: COMPUTE_NO_LIVE_NODE (HTTP 503)"), "the same refusal without --expect-refusal is recorded and exits 1");
                // 4b. Not every answer that is not 2xx is a refusal. Only the Core's named refusal code is;
                // an auth failure, a fault and a rejected request each have their own state, and
                // --expect-refusal exits 1 for all of them.
                fixture.Mode = "force";
                foreach (string[] c in new[] {
                    new[] { "500", "INTERNAL_ERROR", "", CoreSubmit.SubmitCoreFault }, new[] { "502", null, "html", CoreSubmit.SubmitCoreFault }, new[] { "504", null, "html", CoreSubmit.SubmitCoreFault },
                    new[] { "503", "SCHEDULER_STANDBY", "", CoreSubmit.SubmitCoreFault }, new[] { "503", "ORG_NOT_CONFIGURED", "", CoreSubmit.SubmitCoreFault }, new[] { "503", null, "", CoreSubmit.SubmitCoreFault }, new[] { "503", null, "html", CoreSubmit.SubmitCoreFault },
                    new[] { "401", "UNAUTHORIZED", "", CoreSubmit.SubmitAuthFailed }, new[] { "403", "CROSS_ORG_DENIED", "", CoreSubmit.SubmitAuthFailed }, new[] { "401", "COMPUTE_NO_LIVE_NODE", "", CoreSubmit.SubmitAuthFailed }, new[] { "403", "COMPUTE_NO_LIVE_NODE", "", CoreSubmit.SubmitAuthFailed }, new[] { "403", null, "html", CoreSubmit.SubmitAuthFailed },
                    new[] { "400", "JOB_INVALID", "", CoreSubmit.SubmitRejected }, new[] { "409", "IDEMPOTENCY_CONFLICT", "", CoreSubmit.SubmitRejected }, new[] { "413", "JOB_INPUT_TOO_LARGE", "", CoreSubmit.SubmitRejected }, new[] { "404", null, "html", CoreSubmit.SubmitRejected } })
                {
                    fixture.ForceStatus = int.Parse(c[0]); fixture.ForceCode = c[1]; fixture.ForceHtml = c[2] == "html";
                    string label = "HTTP " + c[0] + " " + (c[1] ?? "(no code)") + (fixture.ForceHtml ? " as an HTML page" : "");
                    foreach (bool expecting in new[] { true, false })
                    {
                        Dictionary<string, object> answered = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, expecting, null, store, none, 20);
                        object failure = answered["submit_failure"];
                        Assert((string)answered["state"] == c[3] && CoreSubmit.ExitCode(answered) == 1 && answered["refusal"] == null && answered["job"] == null && Json.Str(failure, "kind") == c[3] && Convert.ToInt32(Json.Get(failure, "http_status")) == fixture.ForceStatus && (Json.Get(failure, "code") as string) == c[1] && ((string)answered["error"]).Contains("HTTP " + c[0]) && CoreSubmit.Summary(answered).Contains("Not a refusal (" + c[3] + "): HTTP " + c[0]), label + " on submit is " + c[3] + ", not a refusal, and exits 1 " + (expecting ? "under --expect-refusal" : "without --expect-refusal") + ": " + answered["state"]);
                    }
                }
                foreach (string code in CoreSubmit.RefusalCodes)
                {
                    fixture.ForceStatus = 503; fixture.ForceCode = code; fixture.ForceHtml = false;
                    Dictionary<string, object> named = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, true, null, store, none, 20);
                    Assert((string)named["state"] == "refused_as_expected" && CoreSubmit.ExitCode(named) == 0 && Json.Str(named["refusal"], "code") == code && named["submit_failure"] == null, "the Core's named refusal code " + code + " is a refusal");
                }
                fixture.ForceStatus = 502; fixture.ForceCode = null; fixture.ForceHtml = true;
                File.WriteAllText(Path.Combine(root, "core-submit-core-fault.json"), Json.Pretty(CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, true, null, store, none, 20)));
                Assert(CoreSubmit.ClassifySubmit(503, Json.Parse("{\"code\":\"COMPUTE_NO_LIVE_NODE\"}")) == CoreSubmit.SubmitRefused && CoreSubmit.ClassifySubmit(409, Json.Parse("{\"code\":\"CAPABILITY_NOT_ACTIVE\"}")) == CoreSubmit.SubmitRefused && CoreSubmit.ClassifySubmit(503, "COMPUTE_NO_LIVE_NODE") == CoreSubmit.SubmitCoreFault && CoreSubmit.ClassifySubmit(503, null) == CoreSubmit.SubmitCoreFault && CoreSubmit.ClassifySubmit(503, Json.Parse("{\"code\":\"compute_no_live_node\"}")) == CoreSubmit.SubmitCoreFault && CoreSubmit.ClassifySubmit(599, Json.Parse("{}")) == CoreSubmit.SubmitCoreFault && CoreSubmit.ClassifySubmit(418, Json.Parse("{\"code\":\"UNAUTHORIZED\"}")) == CoreSubmit.SubmitRejected && Array.IndexOf(CoreSubmit.RefusalCodes, "UNAUTHORIZED") < 0, "the classification: a named code in a JSON object, exactly spelled, and nothing else, is a refusal");
                fixture.Mode = "accept"; fixture.StatusReads = 0;
                Dictionary<string, object> notRefused = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 30, true, null, store, none, 20);
                File.WriteAllText(Path.Combine(root, "core-submit-not-refused.json"), Json.Pretty(notRefused));
                Assert((string)notRefused["state"] == "accepted_but_refusal_expected" && CoreSubmit.ExitCode(notRefused) == 1 && notRefused["job"] != null && notRefused["receipt"] == null && fixture.StatusReads == 0, "an expected refusal that did not happen is recorded as an accepted job and exits 1, without polling");

                // 5. A wrong token is the Core's 401: an auth failure, recorded, and never the refusal that
                // --expect-refusal waits for. A profile refusal is the desktop's, recorded.
                string wrongDir = root + "-wrong";
                Directory.CreateDirectory(wrongDir);
                try
                {
                    File.WriteAllText(Path.Combine(wrongDir, "admin.token"), "wrong-" + Guid.NewGuid().ToString("N"));
                    string wrongProfile = Path.Combine(wrongDir, "profile.json");
                    File.WriteAllText(wrongProfile, ProfileJson("http://127.0.0.1:" + fixture.Port, null, null));
                    Dictionary<string, object> unauthorized = CoreSubmit.Run(wrongProfile, "say hello", "fixture.echo.local", 30, true, null, null, none, 20);
                    Assert((string)unauthorized["state"] == "auth_failed" && CoreSubmit.ExitCode(unauthorized) == 1 && unauthorized["refusal"] == null && Json.Str(unauthorized["submit_failure"], "code") == "UNAUTHORIZED" && Json.Str(unauthorized["submit_failure"], "kind") == "auth_failed" && Convert.ToInt32(Json.Get(unauthorized["submit_failure"], "http_status")) == 401 && fixture.Unauthorized == 1 && ((string)unauthorized["error"]).Contains("A refusal was expected; this is not one."), "a wrong admin token is the Core's 401 UNAUTHORIZED, recorded as auth_failed with exit 1 under --expect-refusal (relative token path resolved beside the profile): " + unauthorized["state"]);
                    File.WriteAllText(wrongProfile, ProfileJson("https://compute.mccluster.org", true, "ca.pem"));
                    int before = fixture.Authorized + fixture.Unauthorized;
                    Dictionary<string, object> production = CoreSubmit.Run(wrongProfile, "say hello", "fixture.echo.local", 30, false, null, null, none, 20);
                    Assert((string)production["state"] == "refused" && CoreSubmit.ExitCode(production) == 1 && Json.Str(production["refusal"], "code") == "PRODUCTION_HOST_REFUSED" && Json.Str(production["refusal"], "refused_by") == "desktop-profile-check" && Json.Str(production["refusal"], "stage") == "profile" && production["core_url_host"] == null && fixture.Authorized + fixture.Unauthorized == before, "a production profile is refused by the desktop before any request is made");
                    File.WriteAllText(Path.Combine(wrongDir, "admin.token"), "  \r\n");
                    File.WriteAllText(wrongProfile, ProfileJson("http://127.0.0.1:" + fixture.Port, null, null));
                    Dictionary<string, object> emptyToken = CoreSubmit.Run(wrongProfile, "say hello", "fixture.echo.local", 30, true, null, null, none, 20);
                    Assert((string)emptyToken["state"] == "error" && CoreSubmit.ExitCode(emptyToken) == 1 && ((string)emptyToken["error"]).StartsWith("TOKEN_FILE_EMPTY") && fixture.Authorized + fixture.Unauthorized == before, "an empty token file is an error (never a refusal that --expect-refusal could mistake), and nothing is sent");
                }
                finally { try { Directory.Delete(wrongDir, true); } catch (Exception) { } }

                // 6. The poll is bounded: a job that never finishes is a timeout, with nothing claimed.
                fixture.Mode = "stuck"; fixture.StatusReads = 0;
                Dictionary<string, object> stuck = CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 5, false, null, store, none, 250);
                File.WriteAllText(Path.Combine(root, "core-submit-timeout.json"), Json.Pretty(stuck));
                Assert((string)stuck["state"] == "timeout" && CoreSubmit.ExitCode(stuck) == 1 && stuck["receipt"] == null && stuck["verification"] == null && stuck["device"] == null && ((string)stuck["error"]).Contains("not terminal after 5 s") && fixture.StatusReads >= 2 && fixture.StatusReads <= 40, "the status poll stops at the bound and records a timeout (" + fixture.StatusReads + " polls)");
                bool badTimeout = (string)CoreSubmit.Run(profilePath, "say hello", "fixture.echo.local", 4, false, null, null, none, 20)["state"] == "error" && (string)CoreSubmit.Run(profilePath, " ", "fixture.echo.local", 30, false, null, null, none, 20)["state"] == "error" && (string)CoreSubmit.Run(profilePath, "x", "", 30, false, null, null, none, 20)["state"] == "error";
                Assert(badTimeout, "an unbounded timeout, an empty prompt or an empty implementation is refused before any request");
            }

            // 7. An unreachable Core is an error after a bounded number of submit requests, not a refusal.
            string deadProfile = Path.Combine(root, "dead-profile.json");
            File.WriteAllText(deadProfile, Json.Compact(new Dictionary<string, object> { { "core_url", "http://127.0.0.1:1" }, { "admin_token_file", tokenFile }, { "org_id", StagingOrg } }));
            Dictionary<string, object> dead = CoreSubmit.Run(deadProfile, "say hello", "fixture.echo.local", 30, true, null, store, none, 20);
            File.WriteAllText(Path.Combine(root, "core-submit-unreachable.json"), Json.Pretty(dead));
            Assert((string)dead["state"] == "error" && CoreSubmit.ExitCode(dead) == 1 && dead["refusal"] == null && Convert.ToInt32(((Dictionary<string, object>)dead["attempts"])["submit_requests"]) == CoreSubmit.MaxSubmitRequests && ((string)dead["error"]).Contains("did not answer"), "an unreachable Core is an error after " + CoreSubmit.MaxSubmitRequests + " submit requests with one Idempotency-Key, never recorded as a refusal: " + dead["error"]);

            // 7b. No absolute local path in a document: a missing profile is named by its file name.
            string missingProfile = Path.Combine(root, "no-such-folder", "missing-profile.json");
            Dictionary<string, object> noProfile = CoreSubmit.Run(missingProfile, "say hello", "fixture.echo.local", 30, false, Path.Combine(root, "core-submit-no-profile.json"), store, none, 20);
            File.WriteAllText(Path.Combine(root, "core-submit-no-profile.json"), Json.Pretty(noProfile));
            Assert((string)noProfile["state"] == "error" && ((string)noProfile["error"]).StartsWith("PROFILE_NOT_FOUND: No staging profile named missing-profile.json in <the folder --profile names>.") && !((string)noProfile["error"]).Contains(root) && !((string)noProfile["error"]).Contains(":\\"), "a missing profile is named by file name and a placeholder, never by its path: " + noProfile["error"]);
            bool pathless = false;
            try { CoreProfile.Load(Path.Combine(root, "x", "profile.json")); } catch (CoreProfileException ex) { pathless = ex.Code == "PROFILE_NOT_FOUND" && !ex.Message.Contains(root) && ex.Message.Contains("profile.json"); }
            Assert(pathless && CoreVerification.VerifyCommand("D:\\some where\\deep\\out.json").EndsWith(" \"<path to out.json>\"") && !CoreVerification.VerifyCommand("D:\\some where\\deep\\out.json").Contains("some where") && CoreVerification.VerifyCommand(null).EndsWith(" \"<the file --core-submit wrote>\""), "the profile error and the verify command carry a file name and a placeholder");
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string scrubbed = LocalPaths.Scrub("could not open " + Path.Combine(localAppData, "McClusterDesktop", "a.json") + " or " + Path.Combine(userProfile, "b.txt").ToUpperInvariant() + " or " + Path.Combine(root, "c.json") + " or D:\\elsewhere\\deep\\d.json", root, "D:\\elsewhere\\deep");
            Assert(scrubbed == "could not open %LOCALAPPDATA%\\McClusterDesktop\\a.json or %USERPROFILE%\\B.TXT or <folder>\\c.json or <folder>\\d.json" && LocalPaths.Scrub(null) == null && LocalPaths.Scrub("C:\\ stays", "C:\\") == "C:\\ stays" && LocalPaths.FileName("C:\\a\\b.json") == "b.json" && LocalPaths.FileName(" ") == null, "an error text that carries a local path is scrubbed to placeholders before it is kept: " + scrubbed);
            int documents = 0;
            foreach (string file in Directory.GetFiles(root, "core-submit*.json", SearchOption.TopDirectoryOnly))
            {
                documents++;
                string text = File.ReadAllText(file);
                Assert(!text.Contains(root) && !text.Contains(root.Replace("\\", "\\\\")) && !text.Contains(userProfile.Replace("\\", "\\\\")) && !text.Contains(localAppData.Replace("\\", "\\\\")), "no output document carries an absolute local path: " + Path.GetFileName(file));
            }
            Assert(documents >= 13, "every recorded document was scanned for local paths (" + documents + ")");

            // 8. The sentinel: grep everything the desktop wrote under the throwaway root (documents, logs).
            int scanned = 0;
            foreach (string file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
            {
                scanned++;
                Assert(!File.ReadAllText(file).Contains(sentinel), "the admin token never appears in an output document or a log: " + file);
            }
            string log = File.ReadAllText(store.LogPath);
            Assert(scanned >= 9 && log.Contains("\"event\":\"core_staging_submit\"") && log.Contains("\"state\":\"done\"") && log.Contains("\"refusal_code\":\"COMPUTE_NO_LIVE_NODE\"") && log.Contains("\"submit_failure_kind\":\"core_fault\"") && log.Contains("\"submit_failure_kind\":\"auth_failed\"") && log.Contains("\"state\":\"done_unverified\""), "the log records each submission by host, state, refusal code and submit failure kind (" + scanned + " files scanned)");
            Assert(CoreJobsClient.Redact("a " + sentinel + " b " + sentinel, sentinel) == "a [redacted] b [redacted]" && CoreJobsClient.Redact(null, sentinel) == null, "redaction replaces every occurrence");
        }
        finally
        {
            foreach (string dir in new[] { root, tokenDir }) { try { Directory.Delete(dir, true); } catch (Exception) { } }
        }

        // The verification rules alone, on hand-built documents (no network).
        var input = new Dictionary<string, object> { { "prompt", "p" }, { "temperature", 0.2 } };
        var output = new Dictionary<string, object> { { "model", "m" }, { "content", "c" } };
        string outputHash = Canonical.Sha256Hex(Canonical.Json(output));
        var result = new Dictionary<string, object> { { "output", output }, { "output_sha256", outputHash } };
        Func<string, string, string, string, Dictionary<string, object>> receiptOf = (schema, id, hash, node) => new Dictionary<string, object> {
            { "schema", schema }, { "job", new Dictionary<string, object> { { "id", id }, { "status", "done" } } }, { "input_sha256", Canonical.Sha256Hex(Canonical.Json(input)) }, { "output_sha256", hash },
            { "execution", new Dictionary<string, object> { { "node_id", node } } }, { "signed", true }, { "signature", new Dictionary<string, object> { { "alg", "ed25519" }, { "key_id", "k1" }, { "value", "v" } } } };
        string id1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        var publishedKey = new Dictionary<string, object> { { "key_id", "k1" }, { "public_key_pem", "test public key text" } };
        var good = CoreVerification.Check(id1, input, result, receiptOf("mccluster-job-receipt/1", id1, outputHash, "node_x"), publishedKey, null);
        // Each requirement on its own: the only failed check is the one named.
        Func<Dictionary<string, object>, object, string> onlyReason = delegate(Dictionary<string, object> receiptDoc, object keyDoc)
        {
            Dictionary<string, object> verdict = CoreVerification.Check(id1, input, result, receiptDoc, keyDoc, null);
            var reasons = (List<object>)verdict["desktop_checks_failed"];
            if ((bool)verdict["desktop_checks_passed"] || reasons.Count == 0 || !((string)verdict["sentence"]).Contains("Desktop checks did NOT pass: ")) return "PASSED";
            return string.Join(" | ", reasons);
        };
        Func<Dictionary<string, object>> goodReceipt = () => receiptOf("mccluster-job-receipt/1", id1, outputHash, "node_x");
        Assert(((List<object>)good["desktop_checks_failed"]).Count == 0 && (bool)good["receipt_signature_present"] && (bool)good["receipt_key_present"], "the complete receipt has no failed check");
        Dictionary<string, object> r = goodReceipt(); r["signed"] = false;
        Assert(onlyReason(r, publishedKey) == "the receipt does not say signed=true", "signed=false fails: " + onlyReason(r, publishedKey));
        r = goodReceipt(); r.Remove("signed");
        Assert(onlyReason(r, publishedKey) == "the receipt does not say signed=true", "a missing signed flag fails");
        r = goodReceipt(); r["signed"] = "true";
        Assert(onlyReason(r, publishedKey) == "the receipt does not say signed=true", "the string \"true\" is not signed=true");
        r = goodReceipt(); r["signature"] = new Dictionary<string, object> { { "alg", "ed25519" }, { "key_id", "k1" }, { "value", " " } };
        Assert(onlyReason(r, publishedKey) == "the receipt carries no signature value", "an empty signature value fails: " + onlyReason(r, publishedKey));
        r = goodReceipt(); r["signature"] = new Dictionary<string, object> { { "alg", "ed25519" }, { "value", "v" } };
        Assert(onlyReason(r, publishedKey) == "the receipt signature names no key id", "a signature without a key id fails: " + onlyReason(r, publishedKey));
        r = goodReceipt(); r["signature"] = null;
        Assert(onlyReason(r, publishedKey) == "the receipt carries no signature value | the receipt signature names no key id", "signed=true with no signature block fails twice: " + onlyReason(r, publishedKey));
        Assert(onlyReason(goodReceipt(), null) == "no receipt key (key id and public key) was read from the Core" && onlyReason(goodReceipt(), new Dictionary<string, object> { { "key_id", "k1" }, { "public_key_pem", null } }) == "no receipt key (key id and public key) was read from the Core" && onlyReason(goodReceipt(), new Dictionary<string, object> { { "key_id", null }, { "public_key_pem", "text" } }) == "no receipt key (key id and public key) was read from the Core", "a missing receipt key, or one without its id or its public key, fails");
        Assert(onlyReason(goodReceipt(), new Dictionary<string, object> { { "key_id", "k2" }, { "public_key_pem", "text" } }) == "the receipt signature's key id is not the published receipt key's", "a receipt signed under another key id than the published one fails");
        r = goodReceipt(); r["input_sha256"] = null;
        Assert(onlyReason(r, publishedKey) == "the receipt carries no input hash" && CoreVerification.Check(id1, input, result, r, publishedKey, null)["input_hash_matches"] == null, "a missing input hash is a failed check, not a pass");
        r = goodReceipt(); r["output_sha256"] = "";
        Assert(onlyReason(r, publishedKey) == "the receipt carries no output hash" && CoreVerification.Check(id1, input, result, r, publishedKey, null)["output_hash_matches"] == null, "a missing output hash is a failed check, not a pass");
        Assert(((List<object>)CoreVerification.Check(id1, null, result, goodReceipt(), publishedKey, null)["desktop_checks_failed"]).Contains("no submitted input to compare with the receipt's input hash"), "an input hash that could not be compared is a failed check");
        Assert(onlyReason(receiptOf("mccluster-job-receipt/1", id1, "00" + outputHash.Substring(2), "node_x"), publishedKey) == "the result's output does not hash to the receipt's output hash" && onlyReason(receiptOf("mccluster-desktop-receipt/2", id1, outputHash, "node_x"), publishedKey).StartsWith("the receipt schema is mccluster-desktop-receipt/2") && onlyReason(receiptOf("mccluster-job-receipt/1", id1, outputHash, " "), publishedKey) == "the receipt names no device (execution.node_id)", "with the key present, a wrong hash, schema or device is the one reason recorded");
        var attested = goodReceipt(); attested["node_attestation"] = new Dictionary<string, object> { { "verified", true }, { "matches_output", true }, { "node_id", "node_x" } };
        var copied = (Dictionary<string, object>)CoreVerification.Check(id1, input, result, attested, publishedKey, null)["node_attestation_as_reported_by_core"];
        Assert(copied.ContainsKey("core_reports_verified") && (bool)copied["core_reports_verified"] && !copied.ContainsKey("verified") && (bool)copied["checked_by_desktop"] == false && !Json.Compact(CoreVerification.Check(id1, input, result, attested, publishedKey, null)).Contains("\"verified\""), "the Core's attestation verdict is copied as core_reports_verified; the verification block has no field named verified");
        Assert((bool)good["desktop_checks_passed"] && (bool)good["receipt_signature_checked"] == false && (bool)good["receipt_claims_signed"] && (bool?)good["receipt_key_id_equals_published_key_id"] == true && ((string)good["receipt_signature_verify_command"]).Contains("<the file --core-submit wrote>") && ((string)good["sentence"]).EndsWith("Desktop checks passed; signature unverified."), "a signed receipt that passes every desktop check is still 'signature unverified'");
        Assert(!(bool)CoreVerification.Check(id1, input, result, receiptOf("mccluster-desktop-receipt/2", id1, outputHash, "node_x"), null, null)["desktop_checks_passed"], "a wrong receipt schema fails");
        Assert(!(bool)CoreVerification.Check(id1, input, result, receiptOf("mccluster-job-receipt/1", "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee", outputHash, "node_x"), null, null)["desktop_checks_passed"], "a receipt for another job fails");
        Assert(!(bool)CoreVerification.Check(id1, input, result, receiptOf("mccluster-job-receipt/1", id1, "00" + outputHash.Substring(2), "node_x"), null, null)["desktop_checks_passed"], "a wrong output hash fails");
        Assert(!(bool)CoreVerification.Check(id1, input, result, receiptOf("mccluster-job-receipt/1", id1, outputHash, " "), null, null)["desktop_checks_passed"], "a receipt that names no device fails");
        Assert(!(bool)CoreVerification.Check(id1, new Dictionary<string, object> { { "prompt", "other" } }, result, receiptOf("mccluster-job-receipt/1", id1, outputHash, "node_x"), null, null)["desktop_checks_passed"], "a receipt whose input hash is not what was submitted fails");
        Assert(!(bool)CoreVerification.Check(id1, input, null, receiptOf("mccluster-job-receipt/1", id1, outputHash, "node_x"), null, null)["desktop_checks_passed"] && !(bool)CoreVerification.Check(id1, input, result, null, null, null)["desktop_checks_passed"] && (string)CoreVerification.Check(id1, input, result, null, null, null)["sentence"] == "No receipt was read; nothing is verified.", "no result or no receipt is never a pass");
    }

    // The panel's two long operations: separate cancellation, and no target change while either runs.
    private static void PanelRunsChecks()
    {
        var runs = new PanelRuns();
        Assert(runs.TargetsSelectable && !runs.AnyBusy && !runs.LocalBusy && !runs.StagingBusy, "idle: the targets are selectable");
        System.Threading.CancellationToken stagingToken = runs.StartStaging();
        Assert(runs.StagingBusy && !runs.LocalBusy && !runs.TargetsSelectable, "while a staging submission waits the targets are not selectable");
        System.Threading.CancellationToken localToken = runs.StartLocal();
        Assert(runs.LocalBusy && runs.StagingBusy && !runs.TargetsSelectable, "both can be in flight, each with its own token");
        runs.CancelStaging();
        Assert(stagingToken.IsCancellationRequested && !localToken.IsCancellationRequested, "stopping the staging wait does not cancel the local job");
        runs.FinishStaging();
        Assert(!runs.StagingBusy && runs.LocalBusy && !runs.TargetsSelectable && !localToken.IsCancellationRequested, "the staging wait ending leaves the local job running and the targets locked");
        System.Threading.CancellationToken secondStaging = runs.StartStaging();
        runs.CancelLocal();
        Assert(localToken.IsCancellationRequested && !secondStaging.IsCancellationRequested, "canceling the local job does not stop the staging wait");
        bool twice = false;
        try { runs.StartLocal(); } catch (InvalidOperationException) { twice = true; }
        bool twiceStaging = false;
        try { runs.StartStaging(); } catch (InvalidOperationException) { twiceStaging = true; }
        Assert(twice && twiceStaging, "a second run of the same kind cannot replace the token of the one in flight");
        runs.FinishLocal();
        Assert(!runs.TargetsSelectable && runs.StagingBusy, "still locked while the staging wait remains");
        runs.FinishStaging();
        runs.CancelLocal(); runs.CancelStaging(); runs.FinishLocal(); runs.FinishStaging();
        Assert(runs.TargetsSelectable && !runs.AnyBusy && !runs.StartLocal().IsCancellationRequested, "idle again: selectable, and a new run gets a fresh token");
        // The panel uses it, and nothing else, for both operations and for the radios.
        string panel = File.ReadAllText(FindSource("StatusPanel.cs"));
        Assert(!panel.Contains("CancellationTokenSource") && panel.Contains("private readonly PanelRuns runs = new PanelRuns();") && panel.Contains("CancellationToken localToken = runs.StartLocal();") && panel.Contains("CancellationToken token = runs.StartStaging();") && panel.Contains("if (runs.LocalBusy) { runs.CancelLocal(); return; }") && panel.Contains("if (runs.StagingBusy) { runs.CancelStaging(); return; }") && panel.Contains("runs.FinishLocal();") && panel.Contains("runs.FinishStaging();"), "the panel holds no cancellation source of its own: the local runner and the staging wait each use theirs");
        Assert(panel.Contains("bool selectable = runs.TargetsSelectable;") && panel.Contains("targetLocal.Enabled = selectable;") && panel.Contains("targetStaging.Enabled = selectable;") && panel.Contains("targetRemote.Enabled = online && selectable;") && panel.Contains("targetGroup.Enabled = false;") && panel.Contains("if (selectable && !online && (targetRemote.Checked || targetGroup.Checked)) targetLocal.Checked = true;") && panel.Contains("&& runs.TargetsSelectable) targetLocal.Checked = true;"), "every target radio is disabled while either runs, and no code path changes the target meanwhile");
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
        Assert(Json.Quote("\b\f\u0001") == "\"\\b\\f\\u0001\"", "backspace and form feed use the short escapes");
        Assert(Json.Quote("x\ud83dy") == "\"x\\ud83dy\"" && Json.Quote("😀") == "\"😀\"", "a lone surrogate is escaped, a pair is raw");
    }
}
