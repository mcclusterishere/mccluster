using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // Proof Mode test adapter for EXO rank receipts. It reads ONLY the two endpoints PR #821's
    // pair adapter reads (GET /node_id, GET /state) from a loopback EXO runtime the owner
    // installed separately, and turns them into an exo-rank-receipt/1 per device. It installs
    // nothing, forwards no chat text, and never claims inference: a two-rank result exists only
    // when two distinct rank receipts with fresh heartbeats are collected AND a generation receipt
    // from the runtime names both ranks; until then inference.mode stays "single-device" or
    // "two-rank-exo (untested)".
    internal static class ExoProbe
    {
        public static bool IsLoopback(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
            if (u.Scheme != "http" && u.Scheme != "https") return false;
            return u.Host == "127.0.0.1" || u.Host == "localhost" || u.Host == "::1" || u.Host == "[::1]";
        }

        public static async Task<Dictionary<string, object>> RankReceipt(string runtimeUrl, string enrolledNodeId)
        {
            var receipt = new Dictionary<string, object>();
            receipt["schema"] = "exo-rank-receipt/1";
            receipt["observed_at"] = JobStore.Now();
            receipt["runtime_url"] = runtimeUrl;
            receipt["enrolled_node_id"] = enrolledNodeId;
            receipt["inference_verified"] = false;
            receipt["claims"] = "diagnostic read of /node_id and /state only; no model loaded, no generation, no shared-inference claim";
            if (!IsLoopback(runtimeUrl)) { receipt["error"] = "runtime_url must be loopback (EXO's API binds 0.0.0.0 by default; keep the probe local)"; return receipt; }
            string baseUrl = runtimeUrl.TrimEnd('/');
            ProbeResult nodeId = await LocalRuntime.GetJson(baseUrl + "/node_id").ConfigureAwait(false);
            ProbeResult state = await LocalRuntime.GetJson(baseUrl + "/state").ConfigureAwait(false);
            receipt["runtime_reachable"] = nodeId.Reachable;
            if (!nodeId.Reachable) { receipt["error"] = "runtime did not answer /node_id: " + nodeId.Detail; return receipt; }
            receipt["runtime_node_id"] = nodeId.Body is string ? (string)nodeId.Body : Convert.ToString(nodeId.Body);
            var members = new List<object>();
            object topology = Json.Get(state.Body, "topology");
            object nodes = Json.Get(topology ?? state.Body, "nodes");
            var dict = nodes as IDictionary;
            if (dict != null)
                foreach (DictionaryEntry e in dict)
                {
                    var m = new Dictionary<string, object>();
                    m["runtime_node_id"] = Convert.ToString(e.Key);
                    m["last_seen"] = Json.Str(e.Value, "lastSeen") ?? Json.Str(e.Value, "last_seen");
                    m["memory"] = Json.Get(e.Value, "memory");
                    members.Add(m);
                }
            else
            {
                IList list = nodes as IList;
                if (list != null) foreach (object n in list) members.Add(new Dictionary<string, object> { { "runtime_node_id", Json.Str(n, "node_id") ?? Json.Str(n, "id") }, { "last_seen", Json.Str(n, "lastSeen") } });
            }
            receipt["members"] = members;
            receipt["member_count"] = members.Count;
            IList instances = Json.List(state.Body, "instances");
            receipt["instances"] = instances == null ? 0 : instances.Count;
            receipt["state_sha256"] = state.Body == null ? null : Canonical.Sha256Hex(Canonical.Json(state.Body));
            receipt["two_rank_candidate"] = members.Count == 2;
            receipt["inference_mode"] = members.Count == 2 ? "two-rank-exo (untested)" : "single-device";
            return receipt;
        }
    }
}
