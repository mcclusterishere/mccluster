using System;
using System.Collections;
using System.IO;
using System.Security.Cryptography;
using UnityEngine;
using UnityEngine.Networking;

namespace McCluster.AR
{
    /// <summary>
    /// The AR client's only door to McCluster. Phase A reads fictional-city data and nothing else.
    ///
    /// Offline first: the business comes from the bundled snapshot in StreamingAssets (exported from the
    /// canonical manifest by tools/ar/export-business.mjs). Optionally it compares that snapshot with the
    /// published manifest — public static data on Matthew's Pages host — by SHA-256, and only REPORTS drift.
    /// It never rewrites lore on device.
    ///
    /// No backend is created here and no endpoint is invented. Identity, missions and state stay with the
    /// existing plane. The routes later phases will call are listed in <see cref="Routes"/>; each one already
    /// exists in this repository, and a later phase wires them with the member's Supabase session exactly as
    /// native/src/mcc.tsx does.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class McClusterApi : MonoBehaviour
    {
        /// <summary>Existing routes only. Nothing here is called in Phase A.</summary>
        public static class Routes
        {
            public const string ApiOrigin = "https://api.mccluster.org";          // Worker `mccluster`
            public const string SupabaseOrigin = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";

            // Identity: Supabase auth stays the credential authority (same calls as native/src/mcc.tsx).
            public const string AuthPasswordToken = SupabaseOrigin + "/auth/v1/token?grant_type=password";
            public const string AuthRefreshToken = SupabaseOrigin + "/auth/v1/token?grant_type=refresh_token";
            public const string Me = ApiOrigin + "/v1/me";                          // workers/mccluster/src/index.js

            // Missions: existing RPCs over Supabase REST with the member's token (js/action.js, js/action-globe.js).
            public const string RpcJoinMission = SupabaseOrigin + "/rest/v1/rpc/join_action_mission_origin";
            public const string RpcPublicRegionMissions = SupabaseOrigin + "/rest/v1/rpc/action_globe_public_region_missions";

            // Live runs (Phase B): workers/mccluster/src/live/index.js. Flag-gated; every route answers 503 until
            // LIVE_MISSIONS_ENABLED is true and supabase/pending/live_missions_v1.sql is applied (docs/control-plane/LIVE-MISSIONS.md).
            public const string LiveSessions = ApiOrigin + "/v1/live/sessions";                  // POST
            public const string LiveChunkFormat = ApiOrigin + "/v1/live/sessions/{0}/chunks/{1}"; // PUT, private recording chunk
            public const string LiveHeartbeatFormat = ApiOrigin + "/v1/live/sessions/{0}/heartbeat";
            public const string LiveCompleteFormat = ApiOrigin + "/v1/live/sessions/{0}/complete";

            // Spatial capture upload: NO ROUTE EXISTS. The addendum's `spatial.capture.submit` is a design
            // placeholder for a Core capability, not an endpoint. Phase A keeps captures on the device.
            public const string SpatialCaptureSubmit = null;

            // Public fictional-city manifest, byte-identical to core/data/fictional-city/district.v1.json.
            public const string PublishedCityManifest = "https://matthew.mccluster.org/data/fictional-city/district.v1.json";
        }

        [Tooltip("Business id in core/data/fictional-city/district.v1.json.")]
        [SerializeField] string businessId = "gauranfucking-tea";

        [Tooltip("Compare the bundled snapshot with the published manifest when online. Report only.")]
        [SerializeField] bool checkPublishedManifest = true;

        public BusinessSnapshot Business { get; private set; }
        public bool IsReady => Business != null;
        public string Error { get; private set; }

        /// <summary>"current", "stale" (re-run the exporter), or "unknown" (offline / not checked).</summary>
        public string SnapshotFreshness { get; private set; } = "unknown";

        public event Action<BusinessSnapshot> Loaded;

        IEnumerator Start()
        {
            yield return LoadSnapshot();
            if (IsReady && checkPublishedManifest) yield return CheckPublishedManifest();
        }

        IEnumerator LoadSnapshot()
        {
            string path = Path.Combine(Application.streamingAssetsPath, "fictional-city", "businesses", businessId + ".json");
            // StreamingAssets lives inside the APK on Android, so read it through UnityWebRequest on every platform.
            string uri = path.Contains("://") ? path : "file://" + path;
            using (var req = UnityWebRequest.Get(uri))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    Error = "Could not read the bundled business snapshot: " + req.error;
                    Debug.LogError("[McClusterApi] " + Error + " (" + uri + ")");
                    yield break;
                }
                var snapshot = JsonUtility.FromJson<BusinessSnapshot>(req.downloadHandler.text);
                if (snapshot == null || snapshot.schema != "mccluster.ar-business/v1" || snapshot.business == null || snapshot.business.id != businessId)
                {
                    Error = "The bundled business snapshot is not mccluster.ar-business/v1 for " + businessId + ".";
                    Debug.LogError("[McClusterApi] " + Error);
                    yield break;
                }
                Business = snapshot;
                Loaded?.Invoke(snapshot);
            }
        }

        IEnumerator CheckPublishedManifest()
        {
            using (var req = UnityWebRequest.Get(Routes.PublishedCityManifest))
            {
                req.timeout = 15;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) { SnapshotFreshness = "unknown"; yield break; }
                string hex;
                using (var sha = SHA256.Create()) hex = ToHex(sha.ComputeHash(req.downloadHandler.data));
                SnapshotFreshness = string.Equals(hex, Business.source?.sha256, StringComparison.OrdinalIgnoreCase) ? "current" : "stale";
                if (SnapshotFreshness == "stale")
                    Debug.Log("[McClusterApi] The published city manifest differs from the bundled snapshot. If this business changed, re-run node tools/ar/export-business.mjs --id " + businessId);
            }
        }

        internal static string ToHex(byte[] bytes)
        {
            var chars = new char[bytes.Length * 2];
            const string digits = "0123456789abcdef";
            for (int i = 0; i < bytes.Length; i++)
            {
                chars[2 * i] = digits[bytes[i] >> 4];
                chars[2 * i + 1] = digits[bytes[i] & 0xF];
            }
            return new string(chars);
        }
    }
}
