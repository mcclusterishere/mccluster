using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // Proof Mode: what a receipt must say and how a client can check it without trusting
    // the transport. Mirrors the shape of PR #823's mccluster-job-receipt/1 where the
    // desktop has the facts (device, model, attempt, timing, inference mode) and signs the
    // local receipt with this device's own key. Algorithm note: .NET Framework 4.8 has no
    // Ed25519, so local receipts are ECDSA P-256 over SHA-256; a Core receipt stays Ed25519
    // and is verified by the Core's reference verifier, never by guesswork here.
    internal static class Canonical
    {
        // RFC 8785 shape for well-formed input: keys sorted by UTF-16 code units, no whitespace,
        // strings escaped as JSON.stringify does, numbers in shortest round-trip form.
        internal static string Json(object value)
        {
            var sb = new StringBuilder();
            Write(sb, value);
            return sb.ToString();
        }

        private static void Write(StringBuilder sb, object value)
        {
            if (value == null) { sb.Append("null"); return; }
            var dict = value as IDictionary;
            if (dict != null)
            {
                var keys = new List<string>();
                foreach (DictionaryEntry e in dict) keys.Add(Convert.ToString(e.Key, CultureInfo.InvariantCulture));
                keys.Sort(string.CompareOrdinal);
                sb.Append('{');
                for (int i = 0; i < keys.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(McClusterDesktop.Json.Quote(keys[i])).Append(':');
                    Write(sb, dict[keys[i]]);
                }
                sb.Append('}');
                return;
            }
            var str = value as string;
            if (str != null) { sb.Append(McClusterDesktop.Json.Quote(str)); return; }
            if (value is bool) { sb.Append((bool)value ? "true" : "false"); return; }
            var list = value as IEnumerable;
            if (list != null)
            {
                sb.Append('[');
                bool first = true;
                foreach (object item in list) { if (!first) sb.Append(','); first = false; Write(sb, item); }
                sb.Append(']');
                return;
            }
            if (value is DateTime) { sb.Append(McClusterDesktop.Json.Quote(((DateTime)value).ToUniversalTime().ToString("o"))); return; }
            if (value is double || value is float || value is decimal)
            {
                double d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (d == Math.Floor(d) && Math.Abs(d) < 1e21) sb.Append(((long)d).ToString(CultureInfo.InvariantCulture));
                else sb.Append(d.ToString("R", CultureInfo.InvariantCulture).Replace("E+", "e+").Replace("E-", "e-"));
                return;
            }
            IFormattable f = value as IFormattable;
            sb.Append(f != null ? f.ToString(null, CultureInfo.InvariantCulture) : McClusterDesktop.Json.Quote(value.ToString()));
        }

        internal static string Sha256Hex(string text)
        {
            using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(text)));
        }

        internal static string Hex(byte[] data)
        {
            var sb = new StringBuilder(data.Length * 2);
            foreach (byte b in data) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    // This device's receipt-signing key: ECDSA P-256, created once, kept DPAPI-protected for
    // the current Windows user under %LOCALAPPDATA%\McClusterDesktop\keys. Never leaves the device.
    internal sealed class DeviceKey : IDisposable
    {
        private readonly ECDsaCng key;
        public readonly string KeyId;
        public readonly string PublicKeyBase64;

        private DeviceKey(ECDsaCng key)
        {
            this.key = key;
            byte[] blob = key.Key.Export(CngKeyBlobFormat.EccPublicBlob);
            PublicKeyBase64 = Convert.ToBase64String(blob);
            using (var sha = SHA256.Create()) KeyId = Canonical.Hex(sha.ComputeHash(blob)).Substring(0, 32);
        }

        public static DeviceKey Load(string root)
        {
            string dir = Path.Combine(root, "keys");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "receipt-signing.p256.dpapi");
            if (File.Exists(path))
            {
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
                return new DeviceKey(new ECDsaCng(CngKey.Import(plain, CngKeyBlobFormat.EccPrivateBlob)));
            }
            var created = new ECDsaCng(CngKey.Create(CngAlgorithm.ECDsaP256, null, new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport, KeyCreationOptions = CngKeyCreationOptions.None }));
            byte[] priv = created.Key.Export(CngKeyBlobFormat.EccPrivateBlob);
            File.WriteAllBytes(path, ProtectedData.Protect(priv, null, DataProtectionScope.CurrentUser));
            return new DeviceKey(created);
        }

        public Dictionary<string, object> Sign(Dictionary<string, object> receipt)
        {
            var copy = new Dictionary<string, object>(receipt);
            copy.Remove("signature");
            copy.Remove("signed");
            copy["signature"] = null;
            string canonical = Canonical.Json(copy);
            key.HashAlgorithm = CngAlgorithm.Sha256;
            byte[] sig = key.SignData(Encoding.UTF8.GetBytes(canonical));
            var signature = new Dictionary<string, object>();
            signature["alg"] = "ecdsa-p256-sha256";
            signature["key_id"] = KeyId;
            signature["public_key"] = PublicKeyBase64;
            signature["value"] = Convert.ToBase64String(sig);
            signature["covers"] = "canonical JSON of this receipt with signature set to null and without the signed flag";
            receipt["signature"] = signature;
            receipt["signed"] = true;
            return receipt;
        }

        // Offline verification of a device-signed receipt: anyone with the receipt alone can run it.
        public static bool Verify(object receipt, out string reason)
        {
            reason = null;
            var dict = receipt as Dictionary<string, object>;
            if (dict == null) { reason = "not an object"; return false; }
            object sigObj = McClusterDesktop.Json.Get(dict, "signature");
            if (sigObj == null) { reason = "unsigned"; return false; }
            if (McClusterDesktop.Json.Str(sigObj, "alg") != "ecdsa-p256-sha256") { reason = "unknown algorithm " + McClusterDesktop.Json.Str(sigObj, "alg"); return false; }
            byte[] pub, sig;
            try { pub = Convert.FromBase64String(McClusterDesktop.Json.Str(sigObj, "public_key")); sig = Convert.FromBase64String(McClusterDesktop.Json.Str(sigObj, "value")); }
            catch (Exception) { reason = "bad encoding"; return false; }
            string keyId;
            using (var sha = SHA256.Create()) keyId = Canonical.Hex(sha.ComputeHash(pub)).Substring(0, 32);
            if (keyId != McClusterDesktop.Json.Str(sigObj, "key_id")) { reason = "key_id does not match public key"; return false; }
            var copy = new Dictionary<string, object>(dict);
            copy.Remove("signature");
            copy.Remove("signed");
            copy["signature"] = null;
            string canonical = Canonical.Json(copy);
            try
            {
                using (var ecdsa = new ECDsaCng(CngKey.Import(pub, CngKeyBlobFormat.EccPublicBlob)))
                {
                    ecdsa.HashAlgorithm = CngAlgorithm.Sha256;
                    if (!ecdsa.VerifyData(Encoding.UTF8.GetBytes(canonical), sig)) { reason = "signature does not verify"; return false; }
                }
            }
            catch (Exception ex) { reason = ex.GetType().Name; return false; }
            return true;
        }

        public void Dispose() { key.Dispose(); }
    }

    // A context reference the job was allowed to read: what it was, how it was scoped, and a
    // hash plus timestamp so the receipt can say exactly which inputs were in play.
    internal static class ContextRefs
    {
        private static readonly HttpClient Http = new HttpClient() { Timeout = TimeSpan.FromSeconds(20) };

        public static Dictionary<string, object> Folder(string path, int files, long bytes, string manifestSha)
        {
            var r = new Dictionary<string, object>();
            r["kind"] = "folder";
            r["ref"] = path;
            r["scope"] = "read-only; file contents never leave the device; manifest hashed";
            r["files"] = files;
            r["bytes"] = bytes;
            r["sha256"] = manifestSha;
            r["observed_at"] = JobStore.Now();
            return r;
        }

        // An approved read-only site route: first-party hosts only, text bounded, hashed and timestamped.
        public static async Task<Dictionary<string, object>> SiteRoute(string url, int maxChars)
        {
            Uri target = NavigationPolicy.HttpsTarget(url);
            if (!NavigationPolicy.IsFirstParty(target)) throw new ArgumentException("Context routes must be first-party HTTPS pages: " + url);
            var r = new Dictionary<string, object>();
            r["kind"] = "site-route";
            r["ref"] = target.AbsoluteUri;
            r["scope"] = "read-only; public page text quoted as evidence, never as instructions";
            using (HttpResponseMessage response = await Http.GetAsync(target).ConfigureAwait(false))
            {
                string text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                r["http_status"] = (int)response.StatusCode;
                string visible = StripTags(text);
                if (visible.Length > maxChars) visible = visible.Substring(0, maxChars);
                r["sha256"] = Canonical.Sha256Hex(text);
                r["chars_used"] = visible.Length;
                r["text"] = visible;
            }
            r["observed_at"] = JobStore.Now();
            return r;
        }

        // Sourced public data with timestamps: the live revision, the local runtime, the model identity.
        public static async Task<List<object>> PublicSources(OllamaStatus ollama, string model)
        {
            var list = new List<object>();
            ProbeResult api = await LocalRuntime.GetJson(LocalRuntime.ApiHealth).ConfigureAwait(false);
            var site = new Dictionary<string, object>();
            site["source"] = LocalRuntime.ApiHealth;
            site["deployment_sha"] = api.Body == null ? null : McClusterDesktop.Json.Str(api.Body, "deployment_sha");
            site["checked_at"] = api.Body == null ? null : McClusterDesktop.Json.Str(api.Body, "checked_at");
            site["observed_at"] = api.CheckedAt.ToString("o", CultureInfo.InvariantCulture);
            site["reachable"] = api.Reachable;
            list.Add(site);
            var rt = new Dictionary<string, object>();
            rt["source"] = ollama.Url + "/api/version";
            rt["ollama_version"] = ollama.Version;
            rt["observed_at"] = JobStore.Now();
            list.Add(rt);
            if (!string.IsNullOrEmpty(model))
            {
                OllamaModel m = ollama.Models.FirstOrDefault(x => string.Equals(x.Name, model, StringComparison.OrdinalIgnoreCase));
                var md = new Dictionary<string, object>();
                md["source"] = ollama.Url + "/api/tags";
                md["model"] = model;
                md["digest"] = m == null ? null : m.Digest;
                md["parameter_size"] = m == null ? null : m.ParameterSize;
                md["quantization"] = m == null ? null : m.Quantization;
                md["observed_at"] = JobStore.Now();
                list.Add(md);
            }
            return list;
        }

        private static string StripTags(string html)
        {
            var sb = new StringBuilder(html.Length);
            bool inTag = false, inScript = false;
            string lower = html.ToLowerInvariant();
            for (int i = 0; i < html.Length; i++)
            {
                char c = html[i];
                if (c == '<')
                {
                    inTag = true;
                    if (string.CompareOrdinal(lower, i, "<script", 0, 7) == 0 || string.CompareOrdinal(lower, i, "<style", 0, 6) == 0) inScript = true;
                    if (string.CompareOrdinal(lower, i, "</script", 0, 8) == 0 || string.CompareOrdinal(lower, i, "</style", 0, 7) == 0) inScript = false;
                    continue;
                }
                if (c == '>') { inTag = false; sb.Append(' '); continue; }
                if (!inTag && !inScript) sb.Append(c);
            }
            return System.Text.RegularExpressions.Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
        }
    }
}
