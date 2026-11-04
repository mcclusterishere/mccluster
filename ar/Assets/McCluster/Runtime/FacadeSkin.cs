using TMPro;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace McCluster.AR
{
    /// <summary>What the person is seeing right now.</summary>
    public enum FacadeMode
    {
        /// <summary>No anchor yet: a floating card asks for the marker.</summary>
        Searching,
        /// <summary>Anchor and world tracking are good: the opaque storefront covers the wall.</summary>
        Facade,
        /// <summary>Tracking degraded: the facade is fading out so it cannot sit on the wrong wall.</summary>
        Fading,
        /// <summary>Still degraded: only a floating sign card, which makes no claim about where the shop is.</summary>
        SignCard,
        /// <summary>Plain camera view. Chosen by the person (always available) or forced when tracking is lost.</summary>
        Reality,
    }

    /// <summary>
    /// Renders one fictional storefront (Phase A: GAURANFUCKING TEA) over a real wall, from the anchor the
    /// <see cref="AnchorProvider"/> reports. Geometry is a facade quad sized in meters (default 6 x 4) with
    /// plain-text signs; no generated video, no logo.
    ///
    /// Occlusion: an AROcclusionManager on the AR camera makes ARCameraBackground write environment depth
    /// (LiDAR iPhone, ARCore Depth API) or human segmentation depth (supported non-LiDAR iPhones) before the
    /// scene draws; the facade shader depth-tests against it, so people and objects in front stay in front.
    ///
    /// Fallback ladder (addendum §2): world tracking limited or anchor dropped -> fade the facade -> floating
    /// sign card -> reality view; world tracking lost -> reality view at once. The reality-view toggle is
    /// drawn by ArHud and is always on screen.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FacadeSkin : MonoBehaviour
    {
        [Header("Wiring")]
        [SerializeField] AnchorProvider anchorProvider;
        [SerializeField] McClusterApi api;
        [SerializeField] Camera arCamera;
        [SerializeField] AROcclusionManager occlusionManager;

        [Header("Facade geometry (meters, measured on the wall)")]
        [Tooltip("Width x height of the storefront to draw.")]
        [SerializeField] Vector2 facadeSizeMeters = new Vector2(6f, 4f);
        [Tooltip("Where the CENTRE of the printed marker sits on the facade, measured from the facade's bottom-centre: x to the right, y up.")]
        [SerializeField] Vector2 markerOnFacadeMeters = new Vector2(0f, 1.5f);
        [Tooltip("Distance the facade is drawn in front of the wall plane, to stay clear of wall texture and depth noise.")]
        [SerializeField] float wallOffsetMeters = 0.02f;

        [Header("Fallback timing (seconds)")]
        [SerializeField] float fadeSeconds = 0.6f;
        [SerializeField] float signCardAfterSeconds = 1.5f;
        [SerializeField] float realityAfterSeconds = 6f;

        [Header("Occlusion requests (honoured only where the device supports them)")]
        [SerializeField] EnvironmentDepthMode environmentDepth = EnvironmentDepthMode.Medium;
        [SerializeField] HumanSegmentationStencilMode humanStencil = HumanSegmentationStencilMode.Fastest;
        [SerializeField] HumanSegmentationDepthMode humanDepth = HumanSegmentationDepthMode.Fastest;

        [Header("Look")]
        [SerializeField] Material facadeMaterialTemplate;

        public FacadeMode Mode { get; private set; } = FacadeMode.Searching;
        public string Reason { get; private set; } = "Starting";
        /// <summary>Set by the HUD. While true nothing virtual is drawn over the camera.</summary>
        public bool RealityViewRequested { get; set; }
        public Vector2 FacadeSizeMeters => facadeSizeMeters;

        static readonly Color Ink = new Color32(0x14, 0x12, 0x10, 0xff);
        static readonly Color Paper = new Color32(0xf2, 0xee, 0xe6, 0xff);

        Transform m_FacadeRoot, m_Content, m_Card;
        Material m_FacadeMaterial, m_CardMaterial;
        TextMeshPro[] m_FacadeTexts = new TextMeshPro[0];
        TextMeshPro[] m_CardTexts = new TextMeshPro[0];
        TextMeshPro m_CardHint;
        float m_Alpha, m_DegradedSince = -1f;
        bool m_Built;

        void Start()
        {
            if (arCamera == null) arCamera = Camera.main;
            if (occlusionManager != null)
            {
                occlusionManager.requestedEnvironmentDepthMode = environmentDepth;
                occlusionManager.requestedHumanStencilMode = humanStencil;
                occlusionManager.requestedHumanDepthMode = humanDepth;
                occlusionManager.requestedOcclusionPreferenceMode = OcclusionPreferenceMode.PreferEnvironmentOcclusion;
            }
            if (api != null)
            {
                if (api.IsReady) Build(api.Business);
                else api.Loaded += Build;
            }
        }

        void OnDestroy()
        {
            if (api != null) api.Loaded -= Build;
        }

        /// <summary>Change the drawn size at runtime (e.g. after measuring the wall); rebuilds the visuals.</summary>
        public void SetFacadeSize(Vector2 meters, Vector2 markerOnFacade)
        {
            facadeSizeMeters = new Vector2(Mathf.Max(0.5f, meters.x), Mathf.Max(0.5f, meters.y));
            markerOnFacadeMeters = markerOnFacade;
            if (api != null && api.IsReady) Build(api.Business);
        }

        void Build(BusinessSnapshot b)
        {
            if (m_FacadeRoot != null) Destroy(m_FacadeRoot.gameObject);
            if (m_Card != null) Destroy(m_Card.gameObject);

            var shader = facadeMaterialTemplate != null ? facadeMaterialTemplate.shader : Shader.Find("McCluster/FacadeUnlit");
            Color brand = b.BusinessColor;
            float W = facadeSizeMeters.x, H = facadeSizeMeters.y;

            // Facade: root follows the anchor frame; content is offset so the marker lands where it was measured.
            m_FacadeRoot = new GameObject("Facade (" + b.business.id + ")").transform;
            m_FacadeRoot.SetParent(transform, false);
            m_Content = new GameObject("Content").transform;
            m_Content.SetParent(m_FacadeRoot, false);
            m_Content.localPosition = new Vector3(-markerOnFacadeMeters.x, H * 0.5f - markerOnFacadeMeters.y, -wallOffsetMeters);

            m_FacadeMaterial = new Material(shader) { name = "Facade", mainTexture = FacadeTexture.Paint(facadeSizeMeters, brand) };
            m_FacadeMaterial.renderQueue = 2990; // body before its text
            Quad(m_Content, "Body", Vector3.zero, new Vector2(W, H), m_FacadeMaterial);

            string ad2 = b.business.ads != null && b.business.ads.Count > 1 ? b.business.ads[1] : "";
            m_FacadeTexts = new[]
            {
                Text(m_Content, "Sign", FacadeTexture.Fascia, 0.86f, 0.70f, b.business.name, Ink, FontStyles.Bold),
                Text(m_Content, "Poster OSD", Sub(FacadeTexture.Poster, 0.05f, 0.84f, 0.9f, 0.12f), 1f, 1f, "PLAY >        SP", Paper, FontStyles.Normal),
                Text(m_Content, "Poster guarantee", Sub(FacadeTexture.Poster, 0.08f, 0.36f, 0.84f, 0.44f), 1f, 1f, b.business.tagline, Paper, FontStyles.Bold),
                Text(m_Content, "Poster counter", Sub(FacadeTexture.Poster, 0.05f, 0.02f, 0.9f, 0.10f), 1f, 1f, "0:00:30", Paper, FontStyles.Normal),
                Text(m_Content, "Window card", FacadeTexture.WindowCard, 0.86f, 0.9f, ad2, Ink, FontStyles.Bold),
                Text(m_Content, "Door plate", Sub(FacadeTexture.Door, 0.08f, 0.70f, 0.84f, 0.12f), 1f, 1f, StaffLine(b), Paper, FontStyles.Normal),
            };

            // Sign card: makes no claim about where the shop is; follows the camera.
            m_Card = new GameObject("Sign card").transform;
            m_Card.SetParent(transform, false);
            m_CardMaterial = new Material(shader) { name = "Sign card", color = new Color(Ink.r, Ink.g, Ink.b, 0.88f) };
            var cardSize = new Vector2(0.60f, 0.34f);
            Quad(m_Card, "Card", Vector3.zero, cardSize, m_CardMaterial);
            var full = new Rect(0, 0, 1, 1);
            m_CardTexts = new[]
            {
                CardText(m_Card, cardSize, Sub(full, 0.06f, 0.60f, 0.88f, 0.30f), b.business.name, brand, FontStyles.Bold),
                CardText(m_Card, cardSize, Sub(full, 0.06f, 0.30f, 0.88f, 0.28f), b.business.tagline, Paper, FontStyles.Normal),
            };
            m_CardHint = CardText(m_Card, cardSize, Sub(full, 0.06f, 0.06f, 0.88f, 0.18f), "", Paper, FontStyles.Italic);

            m_Alpha = 0f;
            ApplyAlpha(0f);
            m_Built = true;
        }

        void Update()
        {
            if (!m_Built) return;

            bool sessionTracking = ARSession.state == ARSessionState.SessionTracking && ARSession.notTrackingReason == NotTrackingReason.None;
            bool sessionLost = ARSession.state < ARSessionState.SessionInitializing;
            bool haveAnchor = anchorProvider != null && anchorProvider.TryGetAnchor(out var anchor) && SetPose(anchor);
            bool anchorUsable = haveAnchor && anchorProvider.TryGetAnchor(out var a2) && a2.quality != AnchorQuality.None;

            FacadeMode next;
            if (RealityViewRequested) { next = FacadeMode.Reality; Reason = "Reality view (your choice)"; m_DegradedSince = -1f; }
            else if (sessionLost) { next = FacadeMode.Reality; Reason = "AR tracking unavailable: " + ARSession.state; }
            else if (!haveAnchor) { next = FacadeMode.Searching; Reason = anchorProvider != null ? anchorProvider.StatusText : "No anchor provider"; m_DegradedSince = -1f; }
            else if (sessionTracking && anchorUsable) { next = FacadeMode.Facade; Reason = anchorProvider.StatusText; m_DegradedSince = -1f; }
            else
            {
                if (m_DegradedSince < 0f) m_DegradedSince = Time.time;
                float t = Time.time - m_DegradedSince;
                Reason = !sessionTracking ? "Tracking limited: " + ARSession.notTrackingReason : anchorProvider.StatusText;
                next = t < signCardAfterSeconds ? FacadeMode.Fading : t < realityAfterSeconds ? FacadeMode.SignCard : FacadeMode.Reality;
            }
            Mode = next;

            float target = Mode == FacadeMode.Facade ? 1f : 0f;
            m_Alpha = Mathf.MoveTowards(m_Alpha, target, Time.deltaTime / Mathf.Max(0.05f, fadeSeconds));
            // Leaving Facade for Reality by choice is immediate: the person asked to see the street.
            if (Mode == FacadeMode.Reality) m_Alpha = 0f;
            ApplyAlpha(m_Alpha);

            bool showCard = Mode == FacadeMode.Searching || Mode == FacadeMode.SignCard;
            m_Card.gameObject.SetActive(showCard);
            if (showCard && arCamera != null)
            {
                var cam = arCamera.transform;
                m_Card.SetPositionAndRotation(cam.position + cam.forward * 1.2f - cam.up * 0.18f, Quaternion.LookRotation(cam.forward, cam.up));
                m_CardHint.text = Mode == FacadeMode.Searching ? "Point the camera at the printed marker." : "Hold still. The storefront returns when tracking does.";
            }
        }

        bool SetPose(AnchorSample anchor)
        {
            m_FacadeRoot.SetPositionAndRotation(anchor.pose.position, anchor.pose.rotation);
            return true;
        }

        void ApplyAlpha(float a)
        {
            if (m_FacadeRoot == null) return;
            m_FacadeRoot.gameObject.SetActive(a > 0.001f);
            var c = m_FacadeMaterial.color; c.a = a; m_FacadeMaterial.color = c;
            foreach (var t in m_FacadeTexts) if (t != null) t.alpha = a;
        }

        static string StaffLine(BusinessSnapshot b)
        {
            if (b.staff == null || b.staff.Count == 0) return "";
            var names = new string[b.staff.Count];
            for (int i = 0; i < names.Length; i++) names[i] = b.staff[i].name;
            return "Today: " + string.Join(" / ", names);
        }

        static Rect Sub(Rect r, float x, float y, float w, float h) =>
            new Rect(r.x + r.width * x, r.y + r.height * y, r.width * w, r.height * h);

        static void Quad(Transform parent, string name, Vector3 localPos, Vector2 size, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad); // visible from -Z: faces the viewer in the facade frame
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = new Vector3(size.x, size.y, 1f);
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
        }

        /// <summary>Text fitted into a facade region (fractions of the facade, from bottom-left).</summary>
        TextMeshPro Text(Transform parent, string name, Rect region, float fillW, float fillH, string s, Color color, FontStyles style)
        {
            float W = facadeSizeMeters.x, H = facadeSizeMeters.y;
            var centre = new Vector3((region.center.x - 0.5f) * W, (region.center.y - 0.5f) * H, -0.005f);
            return MakeText(parent, name, centre, new Vector2(region.width * W * fillW, region.height * H * fillH), s, color, style);
        }

        static TextMeshPro CardText(Transform card, Vector2 cardSize, Rect region, string s, Color color, FontStyles style)
        {
            var centre = new Vector3((region.center.x - 0.5f) * cardSize.x, (region.center.y - 0.5f) * cardSize.y, -0.002f);
            return MakeText(card, "Card text", centre, new Vector2(region.width * cardSize.x, region.height * cardSize.y), s, color, style);
        }

        static TextMeshPro MakeText(Transform parent, string name, Vector3 localPos, Vector2 size, string s, Color color, FontStyles style)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<TextMeshPro>();
            t.rectTransform.sizeDelta = size;
            t.transform.localPosition = localPos;
            t.text = s ?? "";
            t.color = color;
            t.fontStyle = style;
            t.alignment = TextAlignmentOptions.Center;
            t.enableAutoSizing = true;
            t.fontSizeMin = 0.05f;
            t.fontSizeMax = 40f;
            t.raycastTarget = false;
            return t;
        }
    }
}
