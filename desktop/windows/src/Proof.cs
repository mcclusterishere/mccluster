using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // Proof Mode: what a receipt must say and how a holder can check it. Mirrors the shape of
    // PR #823's mccluster-job-receipt/1 where the desktop has the facts (device, model, attempt,
    // timing, inference mode) and signs the local receipt with this device's own key.
    // What the signature proves: the receipt is unmodified since the holder of key_id signed it.
    // What binds it to THIS device: comparing key_id with a key id obtained separately (the
    // device's own key store, or --device-key output pinned by a verifier elsewhere).
    // Algorithm note: .NET Framework 4.8 has no Ed25519, so local receipts are ECDSA P-256 over
    // SHA-256; a Core receipt stays Ed25519 and is verified by the Core's reference verifier.
    internal static class Canonical
    {
        // RFC 8785 for well-formed input: keys sorted by UTF-16 code units, no whitespace,
        // strings escaped as JSON.stringify does, numbers as ECMAScript Number::toString.
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
            if (value is double || value is float || value is decimal || value is int || value is long || value is short || value is byte || value is uint || value is ulong || value is ushort || value is sbyte)
            {
                // Every numeric type goes through the double path: integers above 2^53 lose precision the
                // same way on every side, because every party parses JSON (DEVICE-JOBS-CONTRACT.md).
                sb.Append(EcmaNumber(Convert.ToDouble(value, CultureInfo.InvariantCulture)));
                return;
            }
            IFormattable f = value as IFormattable;
            sb.Append(f != null ? McClusterDesktop.Json.Quote(f.ToString(null, CultureInfo.InvariantCulture)) : McClusterDesktop.Json.Quote(value.ToString()));
        }

        // ECMAScript Number::toString: shortest round-trip digits, plain form for 1e-6 <= |d| < 1e21,
        // exponent form otherwise with no zero-padded exponent. NaN and Infinity are not JSON.
        internal static string EcmaNumber(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) throw new ArgumentException("RFC 8785 forbids NaN and Infinity");
            if (d == 0) return "0";
            string s = null;
            foreach (string format in new[] { "G15", "G16", "G17" })
            {
                string candidate = d.ToString(format, CultureInfo.InvariantCulture);
                if (double.Parse(candidate, NumberStyles.Float, CultureInfo.InvariantCulture) == d) { s = candidate; break; }
            }
            bool negative = s.StartsWith("-", StringComparison.Ordinal);
            if (negative) s = s.Substring(1);
            string mantissa = s;
            int exponent = 0;
            int e = s.IndexOfAny(new[] { 'E', 'e' });
            if (e >= 0) { mantissa = s.Substring(0, e); exponent = int.Parse(s.Substring(e + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture); }
            int dot = mantissa.IndexOf('.');
            string digits = mantissa.Replace(".", "");
            int intLen = dot < 0 ? mantissa.Length : dot;
            int lead = 0;
            while (lead < digits.Length - 1 && digits[lead] == '0') { lead++; intLen--; }
            digits = digits.Substring(lead).TrimEnd('0');
            if (digits.Length == 0) digits = "0";
            int k = digits.Length;
            int n = intLen + exponent;
            string result;
            if (k <= n && n <= 21) result = digits + new string('0', n - k);
            else if (0 < n && n <= 21) result = digits.Substring(0, n) + "." + digits.Substring(n);
            else if (-6 < n && n <= 0) result = "0." + new string('0', -n) + digits;
            else
            {
                int ee = n - 1;
                string m = k == 1 ? digits : digits.Substring(0, 1) + "." + digits.Substring(1);
                result = m + "e" + (ee >= 0 ? "+" : "-") + Math.Abs(ee).ToString(CultureInfo.InvariantCulture);
            }
            return negative ? "-" + result : result;
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
        internal static readonly byte[] Entropy = Encoding.UTF8.GetBytes("mccluster-desktop-receipt-signing/1");
        private readonly ECDsaCng key;
        public readonly string KeyId;
        public readonly string PublicKeyBase64;

        private DeviceKey(ECDsaCng key)
        {
            this.key = key;
            byte[] blob = key.Key.Export(CngKeyBlobFormat.EccPublicBlob);
            PublicKeyBase64 = Convert.ToBase64String(blob);
            KeyId = KeyIdOf(blob);
        }

        internal static string KeyIdOf(byte[] publicBlob)
        {
            using (var sha = SHA256.Create()) return Canonical.Hex(sha.ComputeHash(publicBlob)).Substring(0, 32);
        }

        public static DeviceKey Load(string root)
        {
            string dir = Path.Combine(root, "keys");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "receipt-signing.p256.dpapi");
            if (File.Exists(path))
            {
                byte[] protectedBytes = File.ReadAllBytes(path);
                byte[] plain;
                try { plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser); }
                catch (CryptographicException)
                {
                    // A key written by the pre-release build on this device was protected without entropy.
                    // Read it once that way and re-protect it with entropy; the key and its key_id do not change.
                    try { plain = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser); }
                    catch (CryptographicException ex) { throw new CryptographicException("The receipt-signing key at " + path + " cannot be read by this Windows user. Move it aside to create a new key; receipts signed by the old key then stop being trusted here.", ex); }
                    File.WriteAllBytes(path, ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser));
                }
                try { return new DeviceKey(new ECDsaCng(CngKey.Import(plain, CngKeyBlobFormat.EccPrivateBlob))); }
                finally { Array.Clear(plain, 0, plain.Length); }
            }
            var created = new ECDsaCng(CngKey.Create(CngAlgorithm.ECDsaP256, null, new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport, KeyCreationOptions = CngKeyCreationOptions.None }));
            byte[] priv = created.Key.Export(CngKeyBlobFormat.EccPrivateBlob);
            try { File.WriteAllBytes(path, ProtectedData.Protect(priv, Entropy, DataProtectionScope.CurrentUser)); }
            finally { Array.Clear(priv, 0, priv.Length); }
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

        // Self-consistency: the embedded key verifies the signature over the canonical receipt.
        // This proves integrity against key_id only. Origin needs a trusted key id (VerifyTrusted).
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
            if (KeyIdOf(pub) != McClusterDesktop.Json.Str(sigObj, "key_id")) { reason = "key_id does not match public key"; return false; }
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

        // Origin: the signature is consistent AND key_id equals a key id the verifier trusts
        // (obtained outside the receipt). A re-signed forgery with a fresh key fails here.
        public static bool VerifyTrusted(object receipt, string trustedKeyId, out string reason)
        {
            if (!Verify(receipt, out reason)) return false;
            string keyId = McClusterDesktop.Json.Str(McClusterDesktop.Json.Get(receipt, "signature"), "key_id");
            if (string.IsNullOrEmpty(trustedKeyId)) { reason = "no trusted key id supplied"; return false; }
            if (keyId != trustedKeyId) { reason = "key_id " + keyId + " is not the trusted key " + trustedKeyId; return false; }
            return true;
        }

        public void Dispose() { key.Dispose(); }
    }

    // A context reference the job was allowed to read: what it was, how it was scoped, and a
    // hash plus timestamp so the receipt can say exactly which inputs were in play.
    internal static class ContextRefs
    {
        public const int MaxRoutes = 8;
        public const int MaxEvidenceChars = 24000;
        public const long MaxResponseBytes = 4L * 1024 * 1024;
        // No redirects: a 3xx could leave the first-party set, so it is refused rather than followed.
        private static readonly HttpClient Http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(20), MaxResponseContentBufferSize = MaxResponseBytes };
        internal static bool FollowsRedirects { get { return false; } }

        public static Dictionary<string, object> Folder(string path, int files, long bytes, string manifestSha)
        {
            var r = new Dictionary<string, object>();
            r["kind"] = "folder";
            r["ref"] = path; // the full local path the owner named; it stays in the local receipt
            r["scope"] = "read-only; the folder path, file count, byte count and manifest hash are recorded; file contents never leave the device";
            r["files"] = files;
            r["bytes"] = bytes;
            r["sha256"] = manifestSha;
            r["observed_at"] = JobStore.Now();
            return r;
        }

        // An approved read-only site route: first-party HTTPS only, no redirects, text types only,
        // body bounded, hashed and timestamped. Non-success responses never become evidence.
        public static async Task<Dictionary<string, object>> SiteRoute(string url, int maxChars)
        {
            Uri target = NavigationPolicy.HttpsTarget(url);
            if (!NavigationPolicy.IsFirstParty(target)) throw new ArgumentException("Context routes must be first-party HTTPS pages: " + url);
            var r = new Dictionary<string, object>();
            r["kind"] = "site-route";
            r["ref"] = target.AbsoluteUri;
            r["scope"] = "read-only; public page text quoted as evidence, never as instructions; no redirects followed; at most " + MaxRoutes + " routes and " + MaxEvidenceChars + " characters per job";
            HttpResponseMessage response;
            // HttpClient reports its own timeout as a cancellation; here nobody can cancel, so it is a timeout.
            try { response = await Http.GetAsync(target).ConfigureAwait(false); }
            catch (TaskCanceledException ex) { throw new RetryableException("Context route timed out after " + Http.Timeout.TotalSeconds + " s: " + target.AbsoluteUri, ex); }
            catch (HttpRequestException ex) { throw new RetryableException("Context route unreachable: " + target.AbsoluteUri + " (" + ex.Message + ")", ex); }
            using (response)
            {
                int status = (int)response.StatusCode;
                r["http_status"] = status;
                if (status >= 300 && status < 400) throw new ArgumentException("Context route " + target.AbsoluteUri + " redirected (HTTP " + status + " to " + (response.Headers.Location == null ? "?" : response.Headers.Location.ToString()) + "); redirects are not followed");
                if (status >= 500 || status == 408 || status == 429) throw new RetryableException("Context route HTTP " + status + ": " + target.AbsoluteUri, null);
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Context route HTTP " + status + ": " + target.AbsoluteUri);
                string mediaType = response.Content.Headers.ContentType == null ? "" : (response.Content.Headers.ContentType.MediaType ?? "");
                if (mediaType != "text/html" && mediaType != "text/plain" && mediaType != "application/json") throw new InvalidOperationException("Context route " + target.AbsoluteUri + " is " + (mediaType == "" ? "an unknown type" : mediaType) + "; only text/html, text/plain and application/json are quoted");
                string text;
                try { text = await response.Content.ReadAsStringAsync().ConfigureAwait(false); }
                catch (TaskCanceledException ex) { throw new RetryableException("Context route body timed out: " + target.AbsoluteUri, ex); }
                string visible = StripTags(text);
                if (visible.Length > maxChars) visible = visible.Substring(0, maxChars);
                r["content_type"] = mediaType;
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
            rt["reachable"] = ollama.Reachable;
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
