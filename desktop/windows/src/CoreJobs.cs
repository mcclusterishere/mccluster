using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace McClusterDesktop
{
    // Core (staging): the owner-only path on which the desktop itself submits a job through a Core
    // (docs/control-plane/DEVICE-JOBS-CONTRACT.md on the device-jobs branch, PR #823: mccluster-job/1,
    // mccluster-job-result/1, mccluster-job-receipt/1). It exists for a staging Core only: the profile
    // names the Core, the one CA trusted for it, the file holding the admin token and the organization.
    // Production hosts are refused outright; nothing here ever talks to the production Core.

    // A profile that cannot be used. Refused = a policy refusal (production host, a host that is not
    // loopback and not marked staging, a transport that would expose the token); otherwise an error
    // (missing or unreadable file, malformed field).
    internal sealed class CoreProfileException : Exception
    {
        public readonly bool Refused;
        public readonly string Code;
        public CoreProfileException(string code, string message, bool refused) : base(message) { Code = code; Refused = refused; }
    }

    // The Core could not be reached, or its TLS certificate did not chain to the profile's CA.
    internal sealed class CoreTransportException : Exception
    {
        public CoreTransportException(string message) : base(message) { }
    }

    internal sealed class CoreProfile
    {
        public string ProfilePath;
        public Uri CoreUrl;
        public string Host;          // lower case, no brackets, no trailing dot
        public bool Loopback;
        public bool Staging;         // the profile's own staging=true mark
        public string CaCertPath;    // null when the Core is plain loopback HTTP
        public string AdminTokenFile;
        public string OrgId;

        // Never reachable from this path, whatever the profile says about itself.
        // Each of these domains and every host under it, by suffix: a production name that is added later
        // (or one nobody listed) is refused as well.
        internal static readonly string[] ProductionDomains = { "mccluster.org", "humanuprise.com", "supabase.co" };
        private static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        internal static string DefaultPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktop", "staging", "profile.json");
        }

        internal static bool DefaultExists()
        {
            try { return File.Exists(DefaultPath()); } catch (Exception) { return false; }
        }

        internal static CoreProfile Load(string path)
        {
            string file = string.IsNullOrWhiteSpace(path) ? DefaultPath() : path;
            if (!File.Exists(file)) throw new CoreProfileException("PROFILE_NOT_FOUND", "No staging profile named " + LocalPaths.FileName(file) + " in " + (string.IsNullOrWhiteSpace(path) ? "%LOCALAPPDATA%\\McClusterDesktop\\staging" : "<the folder --profile names>") + ". The owner or the staging serve script writes it; nothing is submitted without one.", false);
            object parsed;
            try { parsed = Json.Parse(File.ReadAllText(file)); }
            catch (Exception ex) { throw new CoreProfileException("PROFILE_INVALID", "The staging profile is not valid JSON (" + ex.GetType().Name + ").", false); }
            CoreProfile profile = Parse(parsed, Path.GetDirectoryName(Path.GetFullPath(file)));
            profile.ProfilePath = file;
            return profile;
        }

        internal static bool IsProductionHost(string host)
        {
            string h = (host ?? "").Trim().Trim('[', ']').TrimEnd('.').ToLowerInvariant();
            foreach (string domain in ProductionDomains)
                if (h == domain || h.EndsWith("." + domain, StringComparison.Ordinal)) return true;
            return false;
        }

        internal static bool IsLoopbackHost(string host)
        {
            string h = (host ?? "").Trim().Trim('[', ']').ToLowerInvariant();
            if (h == "localhost") return true;
            IPAddress address;
            return IPAddress.TryParse(h, out address) && IPAddress.IsLoopback(address);
        }

        // Validation only: no file is opened and nothing is contacted. baseDir resolves relative paths.
        internal static CoreProfile Parse(object json, string baseDir)
        {
            if (Json.Obj(json) == null) throw new CoreProfileException("PROFILE_INVALID", "The staging profile must be a JSON object.", false);
            string rawUrl = Json.Get(json, "core_url") as string;
            if (string.IsNullOrWhiteSpace(rawUrl)) throw new CoreProfileException("PROFILE_INVALID", "core_url is required.", false);
            Uri url;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out url) || (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
                throw new CoreProfileException("PROFILE_INVALID", "core_url must be an absolute http or https URL.", false);
            string host = url.Host.Trim('[', ']').TrimEnd('.').ToLowerInvariant();
            // Production first: no flag, scheme or CA makes a production host acceptable here.
            if (IsProductionHost(host) || IsProductionHost(url.IdnHost) || IsProductionHost(url.DnsSafeHost)) throw new CoreProfileException("PRODUCTION_HOST_REFUSED", "core_url names the production host " + host + ". The Core (staging) path never contacts production.", true);
            if (!string.IsNullOrEmpty(url.UserInfo)) throw new CoreProfileException("PROFILE_INVALID", "core_url must not carry credentials.", false);
            if (!string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment) || (url.AbsolutePath != "/" && url.AbsolutePath != ""))
                throw new CoreProfileException("PROFILE_INVALID", "core_url must be an origin only (scheme, host, port): no path, query or fragment.", false);
            object stagingFlag = Json.Get(json, "staging");
            bool staging = stagingFlag is bool && (bool)stagingFlag;
            bool loopback = IsLoopbackHost(host);
            if (!loopback && !staging) throw new CoreProfileException("NOT_STAGING_REFUSED", "core_url host " + host + " is not loopback and the profile does not mark it staging=true. Refused.", true);
            bool https = url.Scheme == Uri.UriSchemeHttps;
            if (!loopback && !https) throw new CoreProfileException("PLAINTEXT_REFUSED", "core_url host " + host + " is not loopback, so it must be https: the admin token is never sent in clear text off this device.", true);
            string ca = Json.Get(json, "ca_cert_path") as string;
            if (https && string.IsNullOrWhiteSpace(ca)) throw new CoreProfileException("CA_REQUIRED", "core_url is https, so ca_cert_path is required: only the profile's CA is trusted for this host, never the system store.", true);
            string tokenFile = Json.Get(json, "admin_token_file") as string;
            if (string.IsNullOrWhiteSpace(tokenFile)) throw new CoreProfileException("PROFILE_INVALID", "admin_token_file is required (a path; the token itself never belongs in the profile).", false);
            string orgId = Json.Get(json, "org_id") as string;
            if (orgId == null || !Uuid.IsMatch(orgId.Trim())) throw new CoreProfileException("PROFILE_INVALID", "org_id must be a UUID.", false);
            var profile = new CoreProfile();
            profile.CoreUrl = new Uri(url.GetLeftPart(UriPartial.Authority) + "/");
            profile.Host = host;
            profile.Loopback = loopback;
            profile.Staging = staging;
            profile.CaCertPath = string.IsNullOrWhiteSpace(ca) ? null : Resolve(baseDir, ca.Trim());
            profile.AdminTokenFile = Resolve(baseDir, tokenFile.Trim());
            profile.OrgId = orgId.Trim().ToLowerInvariant();
            return profile;
        }

        private static string Resolve(string baseDir, string path)
        {
            string expanded = Environment.ExpandEnvironmentVariables(path);
            return Path.IsPathRooted(expanded) || string.IsNullOrEmpty(baseDir) ? expanded : Path.Combine(baseDir, expanded);
        }

        // "host" or "host:port": what the output file and the panel name. Never a path, never the token.
        internal string HostLabel
        {
            get
            {
                string name = Host.IndexOf(':') >= 0 ? "[" + Host + "]" : Host;
                return CoreUrl.IsDefaultPort ? name : name + ":" + CoreUrl.Port.ToString(CultureInfo.InvariantCulture);
            }
        }

        // Read at call time, every time; the caller keeps it in a local and never stores, logs or prints it.
        internal string ReadToken()
        {
            string text;
            try { text = File.ReadAllText(AdminTokenFile); }
            catch (Exception ex) { throw new CoreProfileException("TOKEN_FILE_UNREADABLE", "The admin token file named by the profile could not be read (" + ex.GetType().Name + ").", false); }
            string token = text.Trim();
            if (token.Length == 0) throw new CoreProfileException("TOKEN_FILE_EMPTY", "The admin token file named by the profile is empty.", false);
            if (token.Length > 4096) throw new CoreProfileException("TOKEN_FILE_INVALID", "The admin token file holds more than 4096 characters; that is not a token.", false);
            foreach (char c in token)
                if (c < 0x21 || c > 0x7e) throw new CoreProfileException("TOKEN_FILE_INVALID", "The admin token file must hold one line of printable ASCII without spaces.", false);
            return token;
        }

        internal X509Certificate2 LoadCa()
        {
            if (CaCertPath == null) return null;
            try { return new X509Certificate2(CoreTls.CertificateBytes(File.ReadAllBytes(CaCertPath))); }
            catch (Exception ex) { throw new CoreProfileException("CA_UNREADABLE", "The CA certificate named by the profile could not be read as a certificate (" + ex.GetType().Name + ").", false); }
        }
    }

    // Keeps this device's folder layout (and with it the user name) out of anything written for others
    // to read: a file is named by its name, a folder by a placeholder.
    internal static class LocalPaths
    {
        internal static string FileName(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            try { string name = Path.GetFileName(path.Trim().TrimEnd('\\', '/')); return string.IsNullOrWhiteSpace(name) ? null : name; }
            catch (Exception) { return null; }
        }

        internal static string FolderOf(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            try { return Path.GetDirectoryName(Path.GetFullPath(path)); } catch (Exception) { return null; }
        }

        private static string ReplaceIgnoreCase(string text, string find, string with)
        {
            if (string.IsNullOrEmpty(find)) return text;
            var sb = new StringBuilder();
            int at = 0;
            while (true)
            {
                int hit = text.IndexOf(find, at, StringComparison.OrdinalIgnoreCase);
                if (hit < 0) { sb.Append(text, at, text.Length - at); break; }
                sb.Append(text, at, hit - at).Append(with);
                at = hit + find.Length;
            }
            return sb.ToString();
        }

        private static string Folder(Environment.SpecialFolder folder)
        {
            try { return Environment.GetFolderPath(folder); } catch (Exception) { return null; }
        }

        // folders: specific folders of this run (the profile's, the output file's), replaced first.
        internal static string Scrub(string text, params string[] folders)
        {
            if (string.IsNullOrEmpty(text)) return text;
            var pairs = new List<KeyValuePair<string, string>>();
            if (folders != null) foreach (string folder in folders) pairs.Add(new KeyValuePair<string, string>(folder, "<folder>"));
            string temp = null;
            try { temp = Path.GetTempPath(); } catch (Exception) { }
            pairs.Add(new KeyValuePair<string, string>(temp, "%TEMP%"));
            pairs.Add(new KeyValuePair<string, string>(Folder(Environment.SpecialFolder.LocalApplicationData), "%LOCALAPPDATA%"));
            pairs.Add(new KeyValuePair<string, string>(Folder(Environment.SpecialFolder.ApplicationData), "%APPDATA%"));
            pairs.Add(new KeyValuePair<string, string>(Folder(Environment.SpecialFolder.UserProfile), "%USERPROFILE%"));
            var usable = new List<KeyValuePair<string, string>>();
            foreach (KeyValuePair<string, string> pair in pairs)
            {
                string folder = (pair.Key ?? "").TrimEnd('\\', '/');
                if (folder.Length >= 4) usable.Add(new KeyValuePair<string, string>(folder, pair.Value)); // never a bare drive root
            }
            usable.Sort(delegate(KeyValuePair<string, string> a, KeyValuePair<string, string> b) { return b.Key.Length.CompareTo(a.Key.Length); });
            foreach (KeyValuePair<string, string> pair in usable) text = ReplaceIgnoreCase(text, pair.Key, pair.Value);
            return text;
        }
    }

    // The certificate decision for one request to the profile's host. It is installed as that request's own
    // ServerCertificateValidationCallback: never ServicePointManager's global callback, never a certificate
    // store. The system trust store is not consulted for the verdict in either direction: a certificate from
    // a public CA is refused here just as an unknown one is, unless its chain ends at the profile's CA.
    internal static class CoreTls
    {
        internal static bool Validate(X509Certificate certificate, SslPolicyErrors errors, X509Certificate2 pinnedCa, string requestHost, string pinnedHost, out string reason)
        {
            return Validate(certificate, null, errors, pinnedCa, requestHost, pinnedHost, out reason);
        }

        // Every certificate the server sent with its leaf, taken from the chain the framework hands the
        // callback (the elements it built and the extra store it filled from the handshake).
        internal static X509Certificate2Collection Presented(X509Chain chain)
        {
            var presented = new X509Certificate2Collection();
            if (chain == null) return presented;
            try
            {
                foreach (X509ChainElement element in chain.ChainElements) presented.Add(element.Certificate);
                foreach (X509Certificate2 extra in chain.ChainPolicy.ExtraStore) presented.Add(extra);
            }
            catch (Exception) { }
            return presented;
        }

        // presented: the intermediates the server sent. They and the pinned CA are the only material the
        // chain is built from besides the leaf; nothing is fetched (see BuildOffline).
        internal static bool Validate(X509Certificate certificate, X509Certificate2Collection presented, SslPolicyErrors errors, X509Certificate2 pinnedCa, string requestHost, string pinnedHost, out string reason)
        {
            reason = null;
            if (pinnedCa == null) { reason = "no CA is pinned for this host"; return false; }
            if (certificate == null || (errors & SslPolicyErrors.RemoteCertificateNotAvailable) != 0) { reason = "the server presented no certificate"; return false; }
            string asked = (requestHost ?? "").Trim('[', ']').TrimEnd('.');
            if (string.IsNullOrEmpty(pinnedHost) || !string.Equals(asked, pinnedHost, StringComparison.OrdinalIgnoreCase)) { reason = "the request host is not the profile's host; the pinned CA vouches for that host only"; return false; }
            if ((errors & SslPolicyErrors.RemoteCertificateNameMismatch) != 0) { reason = "the certificate does not name the profile's host"; return false; }
            X509Certificate2 leaf = certificate as X509Certificate2 ?? new X509Certificate2(certificate);
            X509Chain chain;
            try { chain = BuildOffline(leaf, presented, pinnedCa); }
            catch (Exception ex) { reason = "no certificate chain could be built (" + ex.GetType().Name + ")"; return false; }
            using (chain)
            {
                if (chain.ChainElements.Count == 0) { reason = "no certificate chain could be built"; return false; }
                foreach (X509ChainStatus status in chain.ChainStatus)
                {
                    // An untrusted root is expected: the profile's CA is deliberately not in the system store.
                    if (status.Status == X509ChainStatusFlags.NoError || status.Status == X509ChainStatusFlags.UntrustedRoot) continue;
                    reason = "certificate chain problem: " + status.Status;
                    return false;
                }
                X509Certificate2 root = chain.ChainElements[chain.ChainElements.Count - 1].Certificate;
                if (!SameBytes(root.RawData, pinnedCa.RawData)) { reason = "the certificate does not chain to the profile's CA"; return false; }
            }
            return true;
        }

        // The chain, built by crypt32 directly because .NET Framework 4.8's X509ChainPolicy cannot turn
        // off AIA retrieval. Issuers are looked for in an in-memory collection holding the pinned CA and
        // the certificates the server presented (a memory provider, never a system store; nothing is
        // installed). Flags: CERT_CHAIN_DISABLE_AIA (no issuer is downloaded from a URL the certificate
        // names), CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL (no other URL retrieval either) and no revocation
        // flag at all, which is X509RevocationMode.NoCheck: a private staging CA publishes no revocation
        // data, and a check would be a network call the certificate chooses. The caller then requires the
        // last element to be the pinned CA byte for byte.
        private const uint CertChainDisableAia = 0x00002000;
        private const uint CertChainCacheOnlyUrlRetrieval = 0x00000004;
        internal const uint OfflineChainFlags = CertChainDisableAia | CertChainCacheOnlyUrlRetrieval;

        [StructLayout(LayoutKind.Sequential)]
        private struct CertEnhkeyUsage { public uint Count; public IntPtr Identifiers; }
        [StructLayout(LayoutKind.Sequential)]
        private struct CertUsageMatch { public uint Type; public CertEnhkeyUsage Usage; }
        [StructLayout(LayoutKind.Sequential)]
        private struct CertChainPara { public uint Size; public CertUsageMatch RequestedUsage; }

        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern IntPtr CertOpenStore(IntPtr provider, uint encoding, IntPtr cryptProv, uint flags, IntPtr para);
        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CertCloseStore(IntPtr store, uint flags);
        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CertAddCertificateContextToStore(IntPtr store, IntPtr certContext, uint disposition, IntPtr storeContext);
        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CertGetCertificateChain(IntPtr engine, IntPtr certContext, IntPtr time, IntPtr additionalStore, ref CertChainPara para, uint flags, IntPtr reserved, out IntPtr chainContext);
        [DllImport("crypt32.dll")]
        private static extern void CertFreeCertificateChain(IntPtr chainContext);

        private static X509Chain BuildOffline(X509Certificate2 leaf, X509Certificate2Collection presented, X509Certificate2 pinnedCa)
        {
            IntPtr memory = CertOpenStore(new IntPtr(2) /* CERT_STORE_PROV_MEMORY */, 0, IntPtr.Zero, 0, IntPtr.Zero);
            if (memory == IntPtr.Zero) throw new InvalidOperationException("crypt32 gave no in-memory certificate collection");
            IntPtr context = IntPtr.Zero;
            try
            {
                var extras = new List<X509Certificate2>();
                extras.Add(pinnedCa);
                if (presented != null) foreach (X509Certificate2 extra in presented) if (extra != null) extras.Add(extra);
                foreach (X509Certificate2 extra in extras)
                    if (!CertAddCertificateContextToStore(memory, extra.Handle, 4 /* CERT_STORE_ADD_ALWAYS */, IntPtr.Zero)) throw new InvalidOperationException("a presented certificate could not be read");
                var para = new CertChainPara();
                para.Size = (uint)Marshal.SizeOf(typeof(CertChainPara));
                if (!CertGetCertificateChain(IntPtr.Zero, leaf.Handle, IntPtr.Zero, memory, ref para, OfflineChainFlags, IntPtr.Zero, out context) || context == IntPtr.Zero)
                    throw new InvalidOperationException("crypt32 built no chain");
                GC.KeepAlive(extras);
                GC.KeepAlive(leaf);
                return new X509Chain(context); // duplicates the context; ours is freed below
            }
            finally
            {
                if (context != IntPtr.Zero) CertFreeCertificateChain(context);
                CertCloseStore(memory, 0);
            }
        }

        private static bool SameBytes(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        // DER as it is, or the first certificate of a PEM file. Only a certificate block is read; any
        // other block in the file is ignored and never loaded.
        internal static byte[] CertificateBytes(byte[] file)
        {
            string text = Encoding.ASCII.GetString(file);
            string dashes = new string('-', 5);
            string begin = dashes + "BEGIN CERTIFICATE" + dashes;
            string end = dashes + "END CERTIFICATE" + dashes;
            int start = text.IndexOf(begin, StringComparison.Ordinal);
            if (start < 0) return file;
            int stop = text.IndexOf(end, start, StringComparison.Ordinal);
            if (stop < 0) throw new FormatException("unterminated certificate block");
            string body = text.Substring(start + begin.Length, stop - start - begin.Length);
            return Convert.FromBase64String(Regex.Replace(body, "\\s+", ""));
        }
    }

    internal sealed class CoreResponse
    {
        public int Status;
        public object Body;   // parsed JSON, or null
        public string Text;   // the body with the admin token redacted, bounded
        public bool Ok { get { return Status >= 200 && Status < 300; } }
    }

    // Four calls and one key, exactly the contract's: submit with an Idempotency-Key, status, result,
    // receipt, receipt key. One request at a time, no redirects followed, no proxy, no cookies.
    internal sealed class CoreJobsClient
    {
        private const int MaxBodyBytes = 8 * 1024 * 1024;
        private readonly CoreProfile profile;
        private readonly X509Certificate2 pinnedCa;
        private readonly string connectionGroup = "mccluster-core-staging-" + Guid.NewGuid().ToString("N");
        internal int RequestTimeoutMs = 30000;

        internal CoreJobsClient(CoreProfile profile)
        {
            this.profile = profile;
            pinnedCa = profile.LoadCa();
            if (profile.CoreUrl.Scheme == Uri.UriSchemeHttps && pinnedCa == null) throw new CoreProfileException("CA_REQUIRED", "An https Core needs the profile's CA.", true);
            if (profile.CoreUrl.Scheme != Uri.UriSchemeHttps && !profile.Loopback) throw new CoreProfileException("PLAINTEXT_REFUSED", "Plain http is for a loopback Core only.", true);
        }

        internal CoreResponse Submit(Dictionary<string, object> body, string idempotencyKey)
        {
            return Send("POST", "v1/compute/jobs", Json.Compact(body), idempotencyKey);
        }

        internal CoreResponse Status(string jobId) { return Send("GET", "v1/compute/jobs/" + jobId + "?org_id=" + profile.OrgId, null, null); }
        internal CoreResponse Result(string jobId) { return Send("GET", "v1/compute/jobs/" + jobId + "/result?org_id=" + profile.OrgId, null, null); }
        internal CoreResponse Receipt(string jobId) { return Send("GET", "v1/compute/jobs/" + jobId + "/receipt?org_id=" + profile.OrgId, null, null); }
        internal CoreResponse ReceiptKey() { return Send("GET", "v1/compute/receipt-key", null, null); }

        private CoreResponse Send(string method, string relative, string jsonBody, string idempotencyKey)
        {
            // The token lives in this frame only: read from its file for this call, put in one header,
            // and redacted from anything the server sends back before that text is kept anywhere.
            string token = profile.ReadToken();
            string tlsReason = null;
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var request = (HttpWebRequest)WebRequest.Create(new Uri(profile.CoreUrl, relative));
            request.Method = method;
            request.Proxy = null;
            request.AllowAutoRedirect = false;
            request.KeepAlive = false;
            request.ConnectionGroupName = connectionGroup;
            request.Timeout = RequestTimeoutMs;
            request.ReadWriteTimeout = RequestTimeoutMs;
            request.Accept = "application/json";
            request.UserAgent = "mccluster-desktop/" + typeof(CoreJobsClient).Assembly.GetName().Version.ToString(3) + " core-staging";
            request.Headers["Authorization"] = "Bearer " + token;
            if (idempotencyKey != null) request.Headers["Idempotency-Key"] = idempotencyKey;
            string pinnedHost = profile.Host;
            X509Certificate2 ca = pinnedCa;
            // This request's own callback. Plain loopback HTTP never invokes it.
            request.ServerCertificateValidationCallback = delegate(object sender, X509Certificate certificate, X509Chain chain, SslPolicyErrors errors)
            {
                var asked = sender as HttpWebRequest;
                string reason;
                bool ok = CoreTls.Validate(certificate, CoreTls.Presented(chain), errors, ca, asked == null ? null : asked.RequestUri.Host, pinnedHost, out reason);
                tlsReason = reason;
                return ok;
            };
            try
            {
                if (jsonBody != null)
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
                    request.ContentType = "application/json";
                    request.ContentLength = bytes.Length;
                    using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
                }
                using (var response = (HttpWebResponse)request.GetResponse()) return Read(response, token);
            }
            catch (WebException ex)
            {
                var response = ex.Response as HttpWebResponse;
                if (response != null) using (response) return Read(response, token);
                string detail = tlsReason != null ? "TLS refused: " + tlsReason : ex.Status + ": " + ex.Message;
                throw new CoreTransportException(Redact(method + " /" + relative.Split('?')[0] + " on " + profile.HostLabel + " failed (" + detail + ")", token));
            }
            catch (IOException ex)
            {
                throw new CoreTransportException(Redact(method + " /" + relative.Split('?')[0] + " on " + profile.HostLabel + " failed (" + ex.GetType().Name + ": " + ex.Message + ")", token));
            }
        }

        private static CoreResponse Read(HttpWebResponse response, string token)
        {
            var result = new CoreResponse();
            result.Status = (int)response.StatusCode;
            using (Stream stream = response.GetResponseStream())
            using (var buffer = new MemoryStream())
            {
                var chunk = new byte[16384];
                int read;
                while (stream != null && (read = stream.Read(chunk, 0, chunk.Length)) > 0)
                {
                    buffer.Write(chunk, 0, read);
                    if (buffer.Length > MaxBodyBytes) throw new CoreTransportException("The Core's answer exceeds " + MaxBodyBytes + " bytes; refused.");
                }
                result.Text = Redact(Encoding.UTF8.GetString(buffer.ToArray()), token);
            }
            try { result.Body = Json.Parse(result.Text); } catch (Exception) { result.Body = null; }
            return result;
        }

        internal static string Redact(string text, string token)
        {
            if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(token)) return text;
            return text.Replace(token, "[redacted]");
        }
    }

    // What the desktop can and cannot check about a Core receipt. .NET Framework 4.8 has no Ed25519, so
    // the Core's signature is NOT checked here and the verdict says so, with the command that does check
    // it. The checks below are the ones a holder can do with a hash function alone.
    internal static class CoreVerification
    {
        internal const string ReceiptSchema = "mccluster-job-receipt/1";
        internal const string SignatureReason = "not checked by the desktop: .NET Framework 4.8 has no Ed25519, and the Core signs its receipts with Ed25519. Until the command below is run, this receipt's origin and integrity rest on the TLS channel pinned to the profile's CA (or on loopback), not on a signature this app verified.";

        // The repository's own verifier (verifyReceipt in core/src/compute/jobs.mjs, PR #823), run from the
        // root of a checkout that carries it, on the file --core-submit wrote. Exit 0 only when it verifies.
        internal static string VerifyCommand(string outFile)
        {
            // A file name and a placeholder: the document never carries where on this device it was written.
            string name = LocalPaths.FileName(outFile);
            string file = name == null ? "<the file --core-submit wrote>" : "<path to " + name + ">";
            return "node --input-type=module -e \"import fs from 'node:fs'; import { verifyReceipt } from './core/src/compute/jobs.mjs'; " +
                   "const o = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const v = verifyReceipt(o.receipt, o.receipt_key ? o.receipt_key.public_key_pem : null); " +
                   "console.log(JSON.stringify(v)); process.exit(v.ok ? 0 : 1);\" \"" + file + "\"";
        }

        private static bool IsTrue(object container, string key)
        {
            object value = Json.Get(container, key);
            return value is bool && (bool)value;
        }

        internal static Dictionary<string, object> Check(string jobId, object submittedInput, object result, object receipt, object receiptKey, string outFile)
        {
            var v = new Dictionary<string, object>();
            object execution = Json.Get(receipt, "execution");
            object signature = Json.Get(receipt, "signature");
            object output = Json.Get(result, "output");
            string receiptOut = Json.Get(receipt, "output_sha256") as string;
            string receiptIn = Json.Get(receipt, "input_sha256") as string;
            string schema = Json.Get(receipt, "schema") as string;
            bool? outputMatches = null, resultFieldMatches = null, inputMatches = null;
            string computedOut = output == null ? null : Canonical.Sha256Hex(Canonical.Json(output));
            if (!string.IsNullOrWhiteSpace(receiptOut)) outputMatches = computedOut != null && computedOut == receiptOut;
            string resultOut = Json.Get(result, "output_sha256") as string;
            if (resultOut != null) resultFieldMatches = computedOut != null && computedOut == resultOut;
            if (!string.IsNullOrWhiteSpace(receiptIn) && submittedInput != null) inputMatches = Canonical.Sha256Hex(Canonical.Json(submittedInput)) == receiptIn;
            string receiptJob = Json.Get(Json.Get(receipt, "job"), "id") as string;
            bool jobIdMatches = receipt != null && receiptJob != null && string.Equals(receiptJob, jobId, StringComparison.OrdinalIgnoreCase);
            string nodeId = Json.Get(execution, "node_id") as string;
            bool namesDevice = !string.IsNullOrWhiteSpace(nodeId);
            string status = Json.Get(Json.Get(receipt, "job"), "status") as string;
            v["receipt_present"] = receipt != null;
            v["receipt_schema"] = schema;
            v["receipt_schema_ok"] = schema == ReceiptSchema;
            v["job_id_matches"] = jobIdMatches;
            v["receipt_job_status"] = status;
            v["output_sha256_computed"] = computedOut;
            v["output_hash_matches"] = outputMatches;
            v["result_hash_field_matches"] = resultFieldMatches;
            v["input_hash_matches"] = inputMatches;
            v["receipt_names_device"] = namesDevice;
            v["inference_mode"] = Json.Get(Json.Get(receipt, "inference"), "mode") as string;
            // The Core's own statements, copied and labelled; none of them is a check made here.
            v["receipt_claims_signed"] = IsTrue(receipt, "signed");
            v["receipt_signature_alg"] = Json.Get(signature, "alg") as string;
            v["receipt_signature_key_id"] = Json.Get(signature, "key_id") as string;
            string publishedKeyId = Json.Get(receiptKey, "key_id") as string;
            string publishedKeyPem = Json.Get(receiptKey, "public_key_pem") as string;
            string signedKeyId = Json.Get(signature, "key_id") as string;
            string signatureValue = Json.Get(signature, "value") as string;
            bool claimsSigned = IsTrue(receipt, "signed");
            bool signaturePresent = !string.IsNullOrWhiteSpace(signatureValue);
            bool signatureNamesKey = !string.IsNullOrWhiteSpace(signedKeyId);
            bool keyPresent = receiptKey != null && !string.IsNullOrWhiteSpace(publishedKeyId) && !string.IsNullOrWhiteSpace(publishedKeyPem);
            bool? keyIdEquals = string.IsNullOrWhiteSpace(publishedKeyId) || !signatureNamesKey ? (bool?)null : publishedKeyId == signedKeyId;
            // Presence only: whether the signature is GOOD is not decided here (receipt_signature_checked).
            v["receipt_signature_present"] = signaturePresent;
            v["receipt_key_present"] = keyPresent;
            v["receipt_key_id_equals_published_key_id"] = keyIdEquals.HasValue ? (object)keyIdEquals.Value : null;
            v["receipt_key_source"] = receiptKey == null ? null : "GET /v1/compute/receipt-key on the same Core over the same channel (a key id comparison, not a signature check; an independent verifier pins the key separately)";
            object attestation = Json.Get(receipt, "node_attestation");
            v["node_attestation_as_reported_by_core"] = attestation == null ? null : new Dictionary<string, object> {
                { "core_reports_verified", Json.Get(attestation, "verified") }, { "matches_output", Json.Get(attestation, "matches_output") }, { "node_id", Json.Get(attestation, "node_id") }, { "checked_by_desktop", false } };
            v["receipt_signature_checked"] = false;
            v["receipt_signature_reason"] = SignatureReason;
            v["receipt_signature_verify_command"] = VerifyCommand(outFile);
            // Every check must be made and must pass. One that could not be made (a hash, a signature, a
            // key that is not there) is a failed check with its reason, never a pass by absence.
            var failed = new List<object>();
            if (receipt == null) failed.Add("no receipt was read");
            else
            {
                if (schema != ReceiptSchema) failed.Add("the receipt schema is " + (schema ?? "missing") + ", not " + ReceiptSchema);
                if (!jobIdMatches) failed.Add("the receipt is not for the submitted job id");
                if (status != "done") failed.Add("the receipt's job status is " + (status ?? "missing") + ", not done");
                if (!namesDevice) failed.Add("the receipt names no device (execution.node_id)");
                if (!claimsSigned) failed.Add("the receipt does not say signed=true");
                if (!signaturePresent) failed.Add("the receipt carries no signature value");
                if (!signatureNamesKey) failed.Add("the receipt signature names no key id");
                if (!keyPresent) failed.Add("no receipt key (key id and public key) was read from the Core");
                else if (signatureNamesKey && keyIdEquals != true) failed.Add("the receipt signature's key id is not the published receipt key's");
                if (string.IsNullOrWhiteSpace(receiptIn)) failed.Add("the receipt carries no input hash");
                else if (submittedInput == null) failed.Add("no submitted input to compare with the receipt's input hash");
                else if (inputMatches != true) failed.Add("the receipt's input hash is not the hash of what was submitted");
                if (string.IsNullOrWhiteSpace(receiptOut)) failed.Add("the receipt carries no output hash");
                else if (computedOut == null) failed.Add("no result output was read to compare with the receipt's output hash");
                else if (outputMatches != true) failed.Add("the result's output does not hash to the receipt's output hash");
                if (resultFieldMatches == false) failed.Add("the result's output does not hash to the result's own output_sha256");
            }
            v["desktop_checks_failed"] = failed;
            v["desktop_checks_passed"] = failed.Count == 0;
            v["sentence"] = Sentence(v);
            return v;
        }
        private static string Verdict(object value, string yes, string no, string unknown)
        {
            return value == null ? unknown : ((bool)value ? yes : no);
        }

        // One honest line: what was checked here, what was not.
        internal static string Sentence(Dictionary<string, object> v)
        {
            if (!(bool)v["receipt_present"]) return "No receipt was read; nothing is verified.";
            var sb = new StringBuilder();
            sb.Append("Checked by the desktop: receipt schema ").Append((bool)v["receipt_schema_ok"] ? "ok" : "WRONG (" + (v["receipt_schema"] ?? "none") + ")");
            sb.Append(", job id ").Append((bool)v["job_id_matches"] ? "matches" : "MISMATCH");
            sb.Append(", output hash ").Append(Verdict(v["output_hash_matches"], "matches the result", "MISMATCH", "not checkable (no output hash in the receipt)"));
            sb.Append(", input hash ").Append(Verdict(v["input_hash_matches"], "matches what was submitted", "MISMATCH", "not checkable"));
            sb.Append(", device ").Append((bool)v["receipt_names_device"] ? "named" : "NOT NAMED");
            sb.Append(", signature ").Append((bool)v["receipt_signature_present"] ? "present" : "MISSING").Append(", receipt key ").Append((bool)v["receipt_key_present"] ? "present" : "MISSING").Append(". ");
            sb.Append("Core signature (").Append(v["receipt_signature_alg"] ?? "none").Append((bool)v["receipt_claims_signed"] ? ", the receipt says signed" : ", the receipt says UNSIGNED").Append("): NOT checked here (no Ed25519 in .NET Framework 4.8); run the repository verifier. ");
            if ((bool)v["desktop_checks_passed"]) sb.Append("Desktop checks passed; signature unverified.");
            else
            {
                sb.Append("Desktop checks did NOT pass");
                var failed = v.ContainsKey("desktop_checks_failed") ? v["desktop_checks_failed"] as List<object> : null;
                if (failed != null && failed.Count > 0) sb.Append(": ").Append(string.Join("; ", failed));
                sb.Append(".");
            }
            return sb.ToString();
        }
    }

    // One submission through the Core (staging), start to finish, as one document. Used by
    // McCluster.exe --core-submit and by the panel's "Core (staging)" target, so the two never disagree.
    internal static class CoreSubmit
    {
        internal const string Schema = "mccluster-desktop-core-submit/1";
        internal const int DefaultTimeoutSeconds = 300;
        internal const int MaxSubmitRequests = 3;
        private static readonly Regex JobId = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        // 0: the job is done and every check the desktop can make passed, or a refusal was expected and
        // a refusal (the profile rules, or the Core's named refusal code) was recorded. 1: anything else,
        // including auth_failed, core_fault, submit_rejected and done_unverified.
        internal static int ExitCode(Dictionary<string, object> payload)
        {
            string state = payload["state"] as string;
            return state == "done" || state == "refused_as_expected" ? 0 : 1;
        }

        internal static Dictionary<string, object> Run(string profilePath, string prompt, string implementation, int timeoutSeconds, bool expectRefusal, string outFile, JobStore store, CancellationToken cancel, int pollIntervalMs)
        {
            var total = System.Diagnostics.Stopwatch.StartNew();
            var payload = new Dictionary<string, object>();
            var timings = new Dictionary<string, object>();
            var attempts = new Dictionary<string, object>();
            payload["schema"] = Schema;
            payload["target"] = JobTarget.CoreStaging;
            payload["checked_at"] = JobStore.Now();
            payload["client"] = "mccluster-desktop/" + typeof(CoreSubmit).Assembly.GetName().Version.ToString(3);
            payload["expect_refusal"] = expectRefusal;
            payload["state"] = "error";
            payload["core_url_host"] = null;
            payload["org_id"] = null;
            payload["submitted"] = null;
            payload["refusal"] = null;
            payload["submit_failure"] = null;
            payload["error"] = null;
            payload["job"] = null;
            payload["result"] = null;
            payload["receipt"] = null;
            payload["receipt_key"] = null;
            payload["device"] = null;
            payload["attempts"] = attempts;
            payload["timings"] = timings;
            payload["verification"] = null;
            attempts["submit_requests"] = 0;
            attempts["status_polls"] = 0;
            attempts["poll_errors"] = 0;
            timings["timeout_seconds"] = timeoutSeconds;
            try
            {
                Execute(payload, timings, attempts, profilePath, prompt, implementation, timeoutSeconds, expectRefusal, outFile, cancel, pollIntervalMs);
            }
            catch (CoreProfileException ex)
            {
                if (ex.Refused) Refuse(payload, expectRefusal, "profile", "desktop-profile-check", 0, ex.Code, ex.Message, false);
                else { payload["state"] = "error"; payload["error"] = ex.Code + ": " + ex.Message; }
            }
            catch (CoreTransportException ex) { payload["state"] = "error"; payload["error"] = ex.Message; }
            catch (Exception ex) { payload["state"] = "error"; payload["error"] = ex.GetType().Name + ": " + ex.Message; }
            total.Stop();
            timings["total_ms"] = total.ElapsedMilliseconds;
            // No absolute local path leaves in the document: an exception text that carried one is scrubbed.
            string profileFolder = LocalPaths.FolderOf(string.IsNullOrWhiteSpace(profilePath) ? CoreProfile.DefaultPath() : profilePath);
            string outFolder = LocalPaths.FolderOf(outFile);
            payload["error"] = LocalPaths.Scrub(payload["error"] as string, profileFolder, outFolder);
            foreach (string key in new[] { "refusal", "submit_failure" })
            {
                var block = payload[key] as Dictionary<string, object>;
                if (block != null) block["error"] = LocalPaths.Scrub(block["error"] as string, profileFolder, outFolder);
            }
            if (store != null)
            {
                object job = payload["job"];
                object refusal = payload["refusal"];
                store.Log("core_staging_submit", new Dictionary<string, object> {
                    { "host", payload["core_url_host"] }, { "state", payload["state"] }, { "job_id", Json.Get(job, "job_id") }, { "implementation", implementation },
                    { "refusal_code", Json.Get(refusal, "code") }, { "submit_failure_kind", Json.Get(payload["submit_failure"], "kind") }, { "http_status", Json.Get(refusal, "http_status") ?? Json.Get(payload["submit_failure"], "http_status") }, { "total_ms", total.ElapsedMilliseconds } });
            }
            return payload;
        }

        private static void Refuse(Dictionary<string, object> payload, bool expected, string stage, string refusedBy, int httpStatus, string code, string message, bool retryable)
        {
            payload["refusal"] = new Dictionary<string, object> { { "stage", stage }, { "refused_by", refusedBy }, { "http_status", httpStatus == 0 ? (object)null : httpStatus }, { "code", code }, { "error", message }, { "retryable", retryable }, { "expected", expected } };
            payload["state"] = expected ? "refused_as_expected" : "refused";
        }

        // What a submission that was not accepted means. Only the Core's own named codes for "no eligible
        // device" or "this capability is refused" are a refusal; the status code alone never is.
        internal const string SubmitRefused = "refused";
        internal const string SubmitAuthFailed = "auth_failed";
        internal const string SubmitCoreFault = "core_fault";
        internal const string SubmitRejected = "submit_rejected";
        internal static readonly string[] RefusalCodes = { "COMPUTE_NO_LIVE_NODE", "NO_CAPABILITY_BINDING", "CAPABILITY_NOT_ACTIVE" };

        internal static string ClassifySubmit(int httpStatus, object body)
        {
            // 401 and 403 first: a credential or organization problem is never a job refusal, whatever
            // code the answer carries.
            if (httpStatus == 401 || httpStatus == 403) return SubmitAuthFailed;
            string code = Json.Obj(body) == null ? null : Json.Get(body, "code") as string;
            if (code != null && httpStatus >= 400 && Array.IndexOf(RefusalCodes, code) >= 0) return SubmitRefused;
            // Any other 5xx (500, 502, 503 without a refusal code, 504, a gateway's HTML page) is a fault.
            if (httpStatus >= 500) return SubmitCoreFault;
            return SubmitRejected;
        }

        private static void Execute(Dictionary<string, object> payload, Dictionary<string, object> timings, Dictionary<string, object> attempts, string profilePath, string prompt, string implementation, int timeoutSeconds, bool expectRefusal, string outFile, CancellationToken cancel, int pollIntervalMs)
        {
            if (string.IsNullOrWhiteSpace(prompt)) throw new ArgumentException("A prompt is required.");
            if (string.IsNullOrWhiteSpace(implementation)) throw new ArgumentException("An implementation id is required (the one the target device advertises, for example qwen3-vl.4b.local).");
            if (timeoutSeconds < 5 || timeoutSeconds > 3600) throw new ArgumentException("The timeout must be between 5 and 3600 seconds.");
            CoreProfile profile = CoreProfile.Load(profilePath);
            payload["core_url_host"] = profile.HostLabel;
            payload["org_id"] = profile.OrgId;
            payload["channel"] = profile.CoreUrl.Scheme == Uri.UriSchemeHttps
                ? "https, trusting only the profile's CA for this host (per-request callback)"
                : "plain http on loopback (no TLS; the token never leaves this device)";
            var client = new CoreJobsClient(profile);

            var input = new Dictionary<string, object>();
            input["prompt"] = prompt;
            input["think"] = false;
            input["temperature"] = 0.2;
            input["num_predict"] = 1536;
            string idempotencyKey = "desktop-" + Guid.NewGuid().ToString("N");
            var body = new Dictionary<string, object>();
            body["org_id"] = profile.OrgId;
            body["capability"] = JobKind.Chat;
            body["implementation"] = implementation.Trim();
            body["input"] = input;
            body["max_attempts"] = 3;
            body["client"] = new Dictionary<string, object> { { "name", "mccluster-desktop" }, { "version", typeof(CoreSubmit).Assembly.GetName().Version.ToString(3) } };
            payload["submitted"] = new Dictionary<string, object> { { "capability", JobKind.Chat }, { "implementation", implementation.Trim() }, { "input", input }, { "input_sha256", Canonical.Sha256Hex(Canonical.Json(input)) }, { "max_attempts", 3 }, { "idempotency_key", idempotencyKey } };

            // Submit. Only a transport fault is retried, with the same Idempotency-Key, so a retry can
            // never create a second job. An HTTP answer that is not 2xx is classified (ClassifySubmit):
            // a refusal, an auth failure, a fault or a rejection, each recorded under its own state.
            var submitClock = System.Diagnostics.Stopwatch.StartNew();
            timings["submitted_at"] = JobStore.Now();
            CoreResponse submitted = null;
            string lastTransport = null;
            for (int request = 1; request <= MaxSubmitRequests && submitted == null; request++)
            {
                cancel.ThrowIfCancellationRequested();
                attempts["submit_requests"] = request;
                try { submitted = client.Submit(body, idempotencyKey); }
                catch (CoreTransportException ex)
                {
                    lastTransport = ex.Message;
                    if (request < MaxSubmitRequests) Thread.Sleep(Math.Max(50, pollIntervalMs));
                }
            }
            timings["submit_ms"] = submitClock.ElapsedMilliseconds;
            if (submitted == null) throw new CoreTransportException("The Core did not answer the submission after " + MaxSubmitRequests + " requests: " + lastTransport);
            if (!submitted.Ok)
            {
                object retryable = Json.Get(submitted.Body, "retryable");
                bool retry = retryable is bool && (bool)retryable;
                string code = Json.Get(submitted.Body, "code") as string;
                string message = Json.Get(submitted.Body, "error") as string ?? Truncate(submitted.Text, 500);
                string kind = ClassifySubmit(submitted.Status, submitted.Body);
                if (kind == SubmitRefused) { Refuse(payload, expectRefusal, "submit", "core", submitted.Status, code, message, retry); return; }
                // Not a refusal: --expect-refusal never exits 0 for any of these.
                payload["state"] = kind;
                payload["submit_failure"] = new Dictionary<string, object> { { "kind", kind }, { "stage", "submit" }, { "http_status", submitted.Status }, { "code", code }, { "error", message }, { "retryable", retry }, { "refusal_expected", expectRefusal } };
                string what = kind == SubmitAuthFailed ? "an authentication or authorization failure (the admin token or the organization was not accepted), not a refusal of the job"
                    : kind == SubmitCoreFault ? "a fault in the Core or in front of it, not a refusal of the job"
                    : "a rejection of the request itself, not the Core's 'no eligible device' refusal";
                payload["error"] = "The submission was answered with HTTP " + submitted.Status + (code != null ? " " + code : " and no Core error code") + ": " + what + "." + (expectRefusal ? " A refusal was expected; this is not one." : "");
                return;
            }
            object job = Json.Get(submitted.Body, "job");
            string jobId = Json.Get(job, "job_id") as string;
            if (jobId == null || !JobId.IsMatch(jobId)) throw new InvalidOperationException("The Core accepted the submission but named no job id; nothing more can be read.");
            payload["job"] = job;
            attempts["replayed"] = Json.Get(submitted.Body, "replayed");
            attempts["live_nodes_at_submit"] = Json.Get(submitted.Body, "live_nodes");
            if (expectRefusal)
            {
                // Honest outcome of an expected refusal that did not happen: the job exists on the Core.
                payload["state"] = "accepted_but_refusal_expected";
                payload["error"] = "A refusal was expected, but the Core accepted the job " + jobId + ". It was not polled; there is no cancel route, so it stays on the Core.";
                return;
            }

            // Poll with a bound. Every status change is recorded with the desktop's clock.
            var transitions = new List<object>();
            timings["status_transitions"] = transitions;
            var wait = System.Diagnostics.Stopwatch.StartNew();
            string lastStatus = null;
            int polls = 0, pollErrors = 0;
            bool terminal = false;
            string lastPollError = null;
            while (true)
            {
                if (cancel.IsCancellationRequested)
                {
                    payload["state"] = "canceled_by_owner";
                    payload["error"] = "Waiting was canceled by the owner. The job " + jobId + " stays on the Core (there is no cancel route).";
                    break;
                }
                CoreResponse status = null;
                try { status = client.Status(jobId); polls++; }
                catch (CoreTransportException ex) { pollErrors++; lastPollError = ex.Message; }
                attempts["status_polls"] = polls;
                attempts["poll_errors"] = pollErrors;
                if (status != null && status.Ok && status.Body != null)
                {
                    job = status.Body;
                    payload["job"] = job;
                    string now = Json.Get(job, "status") as string;
                    if (now != lastStatus)
                    {
                        transitions.Add(new Dictionary<string, object> { { "status", now }, { "at", JobStore.Now() }, { "after_submit_ms", wait.ElapsedMilliseconds }, { "node_id", Json.Get(Json.Get(job, "execution"), "node_id") } });
                        lastStatus = now;
                    }
                    object isTerminal = Json.Get(job, "terminal");
                    if (isTerminal is bool && (bool)isTerminal) { terminal = true; break; }
                }
                else if (status != null && (status.Status == 401 || status.Status == 403 || status.Status == 404))
                {
                    throw new InvalidOperationException("The Core refused the status read (HTTP " + status.Status + " " + (Json.Get(status.Body, "code") as string ?? "") + ") for job " + jobId + ".");
                }
                else if (status != null) { pollErrors++; attempts["poll_errors"] = pollErrors; lastPollError = "HTTP " + status.Status; }
                if (wait.ElapsedMilliseconds >= timeoutSeconds * 1000L)
                {
                    payload["state"] = "timeout";
                    payload["error"] = "The job " + jobId + " was not terminal after " + timeoutSeconds + " s (last status " + (lastStatus ?? "unread") + (lastPollError != null ? "; last poll error " + lastPollError : "") + "). It stays on the Core; no result or receipt was read.";
                    break;
                }
                Thread.Sleep(pollIntervalMs);
            }
            timings["wait_ms"] = wait.ElapsedMilliseconds;
            if (!terminal) return;
            timings["terminal_at"] = JobStore.Now();

            object result = null;
            if (lastStatus == "done")
            {
                CoreResponse resultResponse = client.Result(jobId);
                if (resultResponse.Ok) result = resultResponse.Body;
                else payload["error"] = "Result read refused: HTTP " + resultResponse.Status + " " + (Json.Get(resultResponse.Body, "code") as string ?? "");
            }
            payload["result"] = result;
            object receipt = null;
            CoreResponse receiptResponse = client.Receipt(jobId);
            if (receiptResponse.Ok) receipt = receiptResponse.Body;
            else payload["error"] = "Receipt read refused: HTTP " + receiptResponse.Status + " " + (Json.Get(receiptResponse.Body, "code") as string ?? "");
            payload["receipt"] = receipt;
            object receiptKey = null;
            try { CoreResponse keyResponse = client.ReceiptKey(); if (keyResponse.Ok) receiptKey = keyResponse.Body; } catch (CoreTransportException) { }
            payload["receipt_key"] = receiptKey;

            object execution = Json.Get(receipt, "execution");
            attempts["job_attempts"] = Json.Get(job, "attempts");
            attempts["max_attempts"] = Json.Get(job, "max_attempts");
            attempts["lease_attempt"] = Json.Get(execution, "attempt");
            timings["core_started_at"] = Json.Get(execution, "started_at");
            timings["core_completed_at"] = Json.Get(execution, "completed_at");
            timings["core_duration_ms"] = Json.Get(execution, "duration_ms");
            payload["device"] = Device(job, result, receipt);
            Dictionary<string, object> verification = CoreVerification.Check(jobId, input, result, receipt, receiptKey, outFile);
            payload["verification"] = verification;
            if (lastStatus != "done")
            {
                payload["state"] = "job_" + lastStatus;
                object failure = Json.Get(receipt, "failure");
                payload["error"] = "The Core reports the job " + lastStatus + ": " + (Json.Get(failure, "last_error") as string ?? Json.Get(job, "last_error") as string ?? "no error text");
            }
            else if ((bool)verification["desktop_checks_passed"]) payload["state"] = "done";
            else
            {
                // Done on the Core, but not something this app can stand behind: the reasons are recorded.
                payload["state"] = "done_unverified";
                string reasons = "The Core reports the job done, but the desktop's checks did not all pass: " + string.Join("; ", (List<object>)verification["desktop_checks_failed"]) + ".";
                payload["error"] = payload["error"] == null ? reasons : payload["error"] + " " + reasons;
            }
        }

        // Which physical device ran it, as the documents say it, each field with where it came from.
        internal static Dictionary<string, object> Device(object job, object result, object receipt)
        {
            object execution = Json.Get(receipt, "execution");
            object node = Json.Get(result, "node") ?? Json.Get(job, "node");
            object output = Json.Get(result, "output");
            object usage = Json.Get(output, "usage");
            var device = new Dictionary<string, object>();
            bool fromReceipt = execution != null;
            device["node_id"] = fromReceipt ? Json.Get(execution, "node_id") : Json.Get(node, "node_id");
            device["node_display_name"] = fromReceipt ? Json.Get(execution, "node_display_name") : Json.Get(node, "display_name");
            device["platform"] = fromReceipt ? Json.Get(execution, "platform") : Json.Get(node, "platform");
            device["hardware_mode"] = fromReceipt ? Json.Get(execution, "hardware_mode") : Json.Get(node, "hardware_mode");
            device["node_key_fingerprint"] = fromReceipt ? Json.Get(execution, "node_key_fingerprint") : Json.Get(node, "key_fingerprint");
            device["implementation"] = Json.Get(Json.Get(receipt, "job"), "implementation") ?? Json.Get(result, "implementation") ?? Json.Get(job, "implementation");
            device["model"] = Json.Get(output, "model");
            device["model_digest"] = Json.Get(usage, "model_digest");
            device["runtime_version"] = Json.Get(usage, "ollama_version");
            // A staging fixture executor marks its own output; that is never hardware proof.
            object fixture = Json.Get(output, "fixture");
            device["output_marked_fixture"] = fixture is bool && (bool)fixture;
            device["sources"] = new Dictionary<string, object> {
                { "node_id, node_display_name, platform, hardware_mode, node_key_fingerprint", fromReceipt ? "receipt.execution: the Core's statement about the node that held the completing lease (hardware_mode is what that node's agent derived and reported)" : "the job or result view's node summary (no receipt execution was read)" },
                { "implementation", "receipt.job.implementation (the completing lease's), else the result or job view" },
                { "model, model_digest, runtime_version", "result.output as the node committed it (output.model, output.usage.model_digest, output.usage.ollama_version); null when the node's executor did not report it; bound to the receipt by the output hash check when that passes" } };
            return device;
        }

        private static string Truncate(string text, int max)
        {
            if (text == null) return null;
            return text.Length <= max ? text : text.Substring(0, max) + "…";
        }

        private static string Show(object value, string missing)
        {
            if (value == null) return missing;
            string text = Convert.ToString(value, CultureInfo.InvariantCulture);
            return string.IsNullOrWhiteSpace(text) ? missing : text;
        }

        private static string Short(object id)
        {
            string text = id as string;
            if (string.IsNullOrEmpty(text)) return "not named";
            return text.Length <= 17 ? text : text.Substring(0, 17) + "…";
        }

        // What the panel shows above the document: device, model, compute mode, attempts, timing, verdict.
        internal static string Summary(Dictionary<string, object> payload)
        {
            var lines = new List<string>();
            string state = payload["state"] as string;
            lines.Add("Core (staging) " + Show(payload["core_url_host"], "(no host)") + ": " + state);
            object refusal = payload["refusal"];
            if (refusal != null)
                lines.Add("Refused by " + Show(Json.Get(refusal, "refused_by"), "?") + " at " + Show(Json.Get(refusal, "stage"), "?") + ": " + Show(Json.Get(refusal, "code"), "no code") + (Json.Get(refusal, "http_status") != null ? " (HTTP " + Show(Json.Get(refusal, "http_status"), "") + ")" : "") + " " + Show(Json.Get(refusal, "error"), ""));
            object submitFailure = payload.ContainsKey("submit_failure") ? payload["submit_failure"] : null;
            if (submitFailure != null)
                lines.Add("Not a refusal (" + Show(Json.Get(submitFailure, "kind"), "?") + "): HTTP " + Show(Json.Get(submitFailure, "http_status"), "?") + " " + Show(Json.Get(submitFailure, "code"), "no code") + " " + Show(Json.Get(submitFailure, "error"), ""));
            if (payload["error"] != null) lines.Add(Show(payload["error"], ""));
            object device = payload["device"];
            if (device != null)
            {
                lines.Add("Device: " + Show(Json.Get(device, "node_display_name"), "(no display name)") + " · " + Short(Json.Get(device, "node_id")) + " · " + Show(Json.Get(device, "platform"), "platform not reported"));
                lines.Add("Model: " + Show(Json.Get(device, "model"), "not reported") + " · digest " + Show(Json.Get(device, "model_digest"), "not reported") + " · implementation " + Show(Json.Get(device, "implementation"), "not reported"));
                object fixture = Json.Get(device, "output_marked_fixture");
                lines.Add("Compute mode (hardware_mode): " + Show(Json.Get(device, "hardware_mode"), "not reported") + (fixture is bool && (bool)fixture ? " · FIXTURE EXECUTOR OUTPUT: not hardware proof" : ""));
            }
            object attempts = payload["attempts"];
            object timings = payload["timings"];
            if (payload["job"] != null)
            {
                lines.Add("Attempts: job " + Show(Json.Get(attempts, "job_attempts"), "?") + " of " + Show(Json.Get(attempts, "max_attempts"), "?") + " · lease attempt " + Show(Json.Get(attempts, "lease_attempt"), "?") + " · submit requests " + Show(Json.Get(attempts, "submit_requests"), "?") + " · status polls " + Show(Json.Get(attempts, "status_polls"), "?"));
                lines.Add("Timing: on the device " + Show(Json.Get(timings, "core_duration_ms"), "?") + " ms (the Core's lease clock) · submit to terminal " + Show(Json.Get(timings, "wait_ms"), "?") + " ms · total " + Show(Json.Get(timings, "total_ms"), "?") + " ms (this desktop's clock)");
            }
            var verification = payload["verification"] as Dictionary<string, object>;
            if (verification != null) lines.Add(verification["sentence"] as string);
            return string.Join("\n", lines);
        }
    }
}
