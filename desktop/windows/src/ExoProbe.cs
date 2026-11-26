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
    // from the runtime names both ranks; until then inference_mode stays "single-device",
    // "two-rank-exo (untested)" or "unknown".
    internal static class ExoProbe
    {
        public static bool IsLoopback(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
            if (u.Scheme != "http" && u.Scheme != "https") return false;
            return u.Host == "127.0.0.1" || u.Host == "localhost" || u.Host == "::1" || u.Host == "[::1]";
        }

        private static Dictionary<string, object> Member(string id, object node)
        {
            var m = new Dictionary<string, object>();
            m["runtime_node_id"] = id;
            m["last_seen"] = Json.Str(node, "lastSeen") ?? Json.Str(node, "last_seen");
            m["memory"] = Json.Get(node, "memory");
            return m;
        }

        public static async Task<Dictionary<string, object>> RankReceipt(string runtimeUrl, string enrolledNodeId)
        {
            var receipt = new Dictionary<string, object>();
            receipt["schema"] = "exo-rank-receipt/1";
            receipt["observed_at"] = JobStore.Now();
            receipt["runtime_url"] = runtimeUrl;
            receipt["enrolled_node_id"] = enrolledNodeId;
            receipt["inference_verified"] = false;
            receipt["inference_mode"] = "unknown";
            receipt["claims"] = "diagnostic read of /node_id and /state only; no model loaded, no generation, no shared-inference claim";
            if (!IsLoopback(runtimeUrl)) { receipt["error"] = "runtime_url must be loopback (EXO's API binds 0.0.0.0 by default; keep the probe local)"; return receipt; }
            string baseUrl = runtimeUrl.TrimEnd('/');
            ProbeResult nodeId = await LocalRuntime.GetJson(baseUrl + "/node_id").ConfigureAwait(false);
            ProbeResult state = await LocalRuntime.GetJson(baseUrl + "/state").ConfigureAwait(false);
            receipt["runtime_reachable"] = nodeId.Reachable;
            receipt["state_reachable"] = state.Reachable;
            receipt["state_status"] = state.StatusCode;
            if (!nodeId.Reachable) { receipt["error"] = "runtime did not answer /node_id: " + nodeId.Detail; return receipt; }
            receipt["runtime_node_id"] = nodeId.Body is string ? (string)nodeId.Body : Convert.ToString(nodeId.Body);
            if (!state.Reachable || state.Body == null) { receipt["error"] = "runtime did not answer /state: " + state.Detail; return receipt; }
            var members = new List<object>();
            object topology = Json.Get(state.Body, "topology");
            object nodes = Json.Get(topology ?? state.Body, "nodes");
            var dict = nodes as IDictionary;
            IList list = nodes as IList;
            if (dict != null) { foreach (DictionaryEntry e in dict) members.Add(Member(Convert.ToString(e.Key), e.Value)); }
            else if (list != null) { foreach (object n in list) members.Add(Member(Json.Str(n, "node_id") ?? Json.Str(n, "id"), n)); }
            else { receipt["error"] = "state has no recognisable nodes (neither topology.nodes object nor nodes list)"; return receipt; }
            receipt["members"] = members;
            receipt["member_count"] = members.Count;
            object instances = Json.Get(state.Body, "instances");
            IList instanceList = instances as IList;
            IDictionary instanceDict = instances as IDictionary;
            receipt["instances"] = instanceList != null ? instanceList.Count : (instanceDict != null ? instanceDict.Count : 0);
            receipt["state_sha256"] = Canonical.Sha256Hex(Canonical.Json(state.Body));
            receipt["two_rank_candidate"] = members.Count == 2;
            receipt["inference_mode"] = members.Count == 2 ? "two-rank-exo (untested)" : "single-device";
            return receipt;
        }
    }
}
