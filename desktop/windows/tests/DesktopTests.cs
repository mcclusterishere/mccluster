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
            MeteringChecks();
            QuoteArgChecks();
            ContributionChecks();
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
