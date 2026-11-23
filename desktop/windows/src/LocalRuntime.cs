using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // Read-only probes of the three things the desktop client must keep distinct:
    // the OVH Core (through the canonical public hosts), the local model runtime
    // (Ollama on loopback) and the local node agent's state directory. The client
    // never holds a control-plane secret and never calls a hosted inference API.
    internal sealed class ProbeResult
    {
        public bool Reachable;
        public int StatusCode;
        public string Detail;
        public DateTime CheckedAt = DateTime.UtcNow;
        public object Body;
    }

    internal sealed class OllamaModel
    {
        public string Name;
        public long SizeBytes;
        public string Family;
        public string ParameterSize;
        public string Quantization;
        public string Digest;
    }

    internal sealed class OllamaStatus
    {
        public bool Reachable;
        public string Version;
        public string Detail;
        public string Url;
        public List<OllamaModel> Models = new List<OllamaModel>();
        public bool GpuEvidence; // a loaded model with size_vram > 0 (the node agent's rule)
        public string LoadedSummary;
    }

    internal sealed class NodeAgentStatus
    {
        public string StateDir;
        public bool StateDirExists;
        public bool ManifestPresent;
        public bool ConfigPresent;
        public bool IdentityPresent;
        public string NodeName;
        public string ComputeUrl;
        public string Tier;
        public ProbeResult Adapter;
        public List<string> AdvertisedImplementations = new List<string>();
    }

    internal sealed class CoreStatus
    {
        public ProbeResult Api;        // https://api.mccluster.org/v1/health (Cloudflare Worker `mccluster`)
        public string DeploymentSha;
        public ProbeResult ComputeGateway; // https://compute.mccluster.org/health (OVH Core through its tunnel)
        public bool Reachable { get { return Api != null && Api.Reachable && ComputeGateway != null && ComputeGateway.Reachable; } }
    }

    internal static class LocalRuntime
    {
        internal const string ApiHealth = "https://api.mccluster.org/v1/health";
        internal const string ComputeHealth = "https://compute.mccluster.org/health";
        private static readonly HttpClient Http = CreateClient();

        private static HttpClient CreateClient()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var handler = new HttpClientHandler();
            handler.AllowAutoRedirect = false;
            handler.UseCookies = false;
            var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(6);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("mccluster-desktop/0.2");
            return client;
        }

        internal static string OllamaUrl()
        {
            // Loopback only. A non-loopback OLLAMA_HOST is ignored on purpose.
            string host = Environment.GetEnvironmentVariable("OLLAMA_HOST");
            if (!string.IsNullOrWhiteSpace(host))
            {
                string h = host.Trim();
                if (!h.StartsWith("http", StringComparison.OrdinalIgnoreCase)) h = "http://" + h;
                Uri u;
                if (Uri.TryCreate(h, UriKind.Absolute, out u) && (u.Host == "127.0.0.1" || u.Host == "localhost" || u.Host == "::1"))
                    return u.GetLeftPart(UriPartial.Authority);
            }
            return "http://127.0.0.1:11434";
        }

        internal static async Task<ProbeResult> GetJson(string url)
        {
            var result = new ProbeResult();
            try
            {
                using (HttpResponseMessage response = await Http.GetAsync(url).ConfigureAwait(false))
                {
                    result.StatusCode = (int)response.StatusCode;
                    string text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    result.Reachable = response.IsSuccessStatusCode;
                    try { result.Body = Json.Parse(text); } catch (Exception) { result.Body = null; }
                    result.Detail = result.Reachable ? "HTTP " + result.StatusCode : "HTTP " + result.StatusCode + " " + response.ReasonPhrase;
                    if (result.StatusCode == 530) result.Detail = "HTTP 530: Cloudflare could not reach the origin (the OVH Core gateway tunnel is down)";
                }
            }
            catch (TaskCanceledException)
            {
                result.Detail = "timeout";
            }
            catch (HttpRequestException ex)
            {
                Exception inner = ex.InnerException ?? ex;
                result.Detail = inner.GetType().Name + ": " + inner.Message;
            }
            catch (Exception ex)
            {
                result.Detail = ex.GetType().Name + ": " + ex.Message;
            }
            return result;
        }

        internal static async Task<CoreStatus> ProbeCore()
        {
            var status = new CoreStatus();
            Task<ProbeResult> api = GetJson(ApiHealth);
            Task<ProbeResult> gateway = GetJson(ComputeHealth);
            status.Api = await api.ConfigureAwait(false);
            status.ComputeGateway = await gateway.ConfigureAwait(false);
            if (status.Api.Body != null) status.DeploymentSha = Json.Str(status.Api.Body, "deployment_sha");
            return status;
        }

        internal static async Task<OllamaStatus> ProbeOllama()
        {
            var status = new OllamaStatus();
            status.Url = OllamaUrl();
            ProbeResult version = await GetJson(status.Url + "/api/version").ConfigureAwait(false);
            status.Reachable = version.Reachable;
            status.Detail = version.Detail;
            if (!version.Reachable) return status;
            status.Version = Json.Str(version.Body, "version");
            ProbeResult tags = await GetJson(status.Url + "/api/tags").ConfigureAwait(false);
            IList models = Json.List(tags.Body, "models");
            if (models != null)
                foreach (object item in models)
                {
                    var model = new OllamaModel();
                    model.Name = Json.Str(item, "name");
                    model.SizeBytes = (long)Json.Num(item, "size");
                    model.Digest = Json.Str(item, "digest");
                    object details = Json.Get(item, "details");
                    model.Family = Json.Str(details, "family");
                    model.ParameterSize = Json.Str(details, "parameter_size");
                    model.Quantization = Json.Str(details, "quantization_level");
                    status.Models.Add(model);
                }
            ProbeResult ps = await GetJson(status.Url + "/api/ps").ConfigureAwait(false);
            IList loaded = Json.List(ps.Body, "models");
            var parts = new List<string>();
            if (loaded != null)
                foreach (object item in loaded)
                {
                    double size = Json.Num(item, "size");
                    double vram = Json.Num(item, "size_vram");
                    if (vram > 0) status.GpuEvidence = true;
                    int percent = size > 0 ? (int)Math.Round(vram / size * 100) : 0;
                    parts.Add(Json.Str(item, "name") + " (" + percent + "% GPU)");
                }
            status.LoadedSummary = parts.Count == 0 ? "nothing loaded" : string.Join(", ", parts);
            return status;
        }

        internal static string NodeStateDir()
        {
            string dir = Environment.GetEnvironmentVariable("MCCLUSTER_NODE_STATE_DIR");
            if (!string.IsNullOrWhiteSpace(dir)) return dir;
            string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            return Path.Combine(programData, "mccluster-node");
        }

        internal static async Task<NodeAgentStatus> ProbeNodeAgent()
        {
            var status = new NodeAgentStatus();
            status.StateDir = NodeStateDir();
            status.StateDirExists = Directory.Exists(status.StateDir);
            string manifest = Environment.GetEnvironmentVariable("MCCLUSTER_NODE_MANIFEST");
            if (string.IsNullOrWhiteSpace(manifest)) manifest = Path.Combine(status.StateDir, "capabilities.json");
            status.ManifestPresent = File.Exists(manifest);
            string config = Path.Combine(status.StateDir, "node.config.json");
            status.ConfigPresent = File.Exists(config);
            // identity.json holds the node's private key. Its presence is reported; it is never read or shown.
            status.IdentityPresent = File.Exists(Path.Combine(status.StateDir, "identity.json"));
            if (status.ConfigPresent)
            {
                try
                {
                    object cfg = Json.Parse(File.ReadAllText(config));
                    status.NodeName = Json.Str(cfg, "node_name") ?? Json.Str(cfg, "nodeName");
                    status.ComputeUrl = Json.Str(cfg, "compute_url") ?? Json.Str(cfg, "computeUrl");
                    status.Tier = Json.Str(cfg, "tier");
                }
                catch (Exception) { }
            }
            if (status.ManifestPresent)
            {
                try
                {
                    object man = Json.Parse(File.ReadAllText(manifest));
                    IList caps = Json.List(man, "capabilities");
                    if (caps != null)
                        foreach (object cap in caps)
                            status.AdvertisedImplementations.Add(Json.Str(cap, "capability") + "/" + Json.Str(cap, "implementation") + " -> " + (Json.Str(cap, "model") ?? "n/a"));
                }
                catch (Exception) { }
            }
            string port = Environment.GetEnvironmentVariable("MCCLUSTER_OLLAMA_ADAPTER_PORT");
            if (string.IsNullOrWhiteSpace(port)) port = "4790";
            status.Adapter = await GetJson("http://127.0.0.1:" + port + "/health").ConfigureAwait(false);
            return status;
        }
    }
}
