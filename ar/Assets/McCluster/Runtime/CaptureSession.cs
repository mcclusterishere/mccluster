using System;
using System.Collections;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace McCluster.AR
{
    /// <summary>
    /// The one camera session's capture output (addendum §4). It does not open a camera of its own: it
    /// listens to the AR Foundation camera that is already running and pulls the CPU camera image
    /// (ARCameraManager.TryAcquireLatestCpuImage). That image comes from the camera, before any rendering,
    /// so the fake storefront can never be in it. Nothing is read back from the screen.
    ///
    /// Phase A scope: owner-only, explicit opt-in per capture, files stay on the phone under
    /// Application.persistentDataPath/captures/&lt;captureId&gt;/ (frames/*.jpg, depth/*.bin, manifest.json).
    /// No upload, no live stream; Phase B joins this same session to the existing /v1/live path.
    ///
    /// Performance is UNMEASURED. JPEG encoding runs on the main thread at most once per
    /// <see cref="evaluateEverySeconds"/>; the addendum's 30 fps / 15 min gate is a target, not a result.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class CaptureSession : MonoBehaviour
    {
        public const string ProcessingVersion = "mccluster-ar-unity/0.1.0-phase-a";

        [Header("Wiring")]
        [SerializeField] ARCameraManager cameraManager;
        [SerializeField] AROcclusionManager occlusionManager;
        [SerializeField] ARTrackedImageManager trackedImageManager;
        [SerializeField] AnchorProvider anchorProvider;

        [Header("Keyframe selection (uncalibrated starting values)")]
        [SerializeField] float evaluateEverySeconds = 0.5f;
        [SerializeField] float minTranslationMeters = 0.15f;
        [SerializeField] float minRotationDegrees = 10f;
        [SerializeField] float minSharpness = 15f;
        [SerializeField, Range(50, 100)] int jpegQuality = 90;
        [SerializeField] bool saveDepth = true;
        [SerializeField] int maxSelectedFrames = 600;

        public bool IsCapturing { get; private set; }
        public string CaptureFolder { get; private set; }
        public int SelectedCount => m_Manifest != null ? m_Manifest.summary.framesSelected : 0;
        public string LastMessage { get; private set; } = "";

        CaptureManifestV1 m_Manifest;
        float m_NextEvaluate;
        bool m_HasLastSelected;
        Vector3 m_LastPos;
        Quaternion m_LastRot;
        int m_OriginResets;
        bool m_WasTracking;

        void OnEnable() { ARSession.stateChanged += OnSessionState; }
        void OnDisable()
        {
            ARSession.stateChanged -= OnSessionState;
            if (IsCapturing) StopCapture();
        }

        void OnSessionState(ARSessionStateChangedEventArgs e)
        {
            if (e.state == ARSessionState.SessionTracking) m_WasTracking = true;
            else if (e.state == ARSessionState.SessionInitializing && m_WasTracking) { m_OriginResets++; m_WasTracking = false; }
        }

        /// <summary>Begin a capture. <paramref name="consented"/> must come from an explicit on-screen choice.</summary>
        public void StartCapture(bool consented)
        {
            if (IsCapturing || !consented || cameraManager == null) return;
            var now = DateTime.UtcNow;
            string id = "cap-" + now.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            CaptureFolder = Path.Combine(Application.persistentDataPath, "captures", id);
            Directory.CreateDirectory(Path.Combine(CaptureFolder, "frames"));
            Directory.CreateDirectory(Path.Combine(CaptureFolder, "depth"));

            m_Manifest = new CaptureManifestV1();
            var s = m_Manifest.session;
            s.captureId = id;
            s.processingVersion = ProcessingVersion;
            s.consent.spatialCaptureConsented = true;
            s.consent.consentedAtUtc = Iso(now);
            s.anchorProvider = anchorProvider != null ? anchorProvider.ProviderId : "none";
            s.anchorId = anchorProvider != null && anchorProvider.TryGetAnchor(out var a) ? a.anchorId : "";
            FillDevice(s.device);
            m_Manifest.timing.startUtc = Iso(now);
            m_Manifest.timing.startRealtimeSeconds = Time.realtimeSinceStartupAsDouble;

            StartCoroutine(StartLocation());
            m_HasLastSelected = false;
            m_NextEvaluate = 0f;
            cameraManager.frameReceived += OnFrame;
            IsCapturing = true;
            LastMessage = "Capturing clean frames to this phone.";
            WriteManifest();
        }

        public void StopCapture()
        {
            if (!IsCapturing) return;
            cameraManager.frameReceived -= OnFrame;
            IsCapturing = false;
            m_Manifest.summary.stopUtc = Iso(DateTime.UtcNow);
            m_Manifest.summary.closedCleanly = true;
            WriteManifest();
            if (Input.location.status == LocationServiceStatus.Running) Input.location.Stop();
            LastMessage = "Saved " + m_Manifest.summary.framesSelected + " frames to " + CaptureFolder;
            Debug.Log("[CaptureSession] " + LastMessage);
        }

        IEnumerator StartLocation()
        {
#if UNITY_ANDROID
            if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.FineLocation))
            {
                UnityEngine.Android.Permission.RequestUserPermission(UnityEngine.Android.Permission.FineLocation);
                yield return new WaitForSeconds(0.5f);
            }
#endif
            if (!Input.location.isEnabledByUser) yield break;
            Input.location.Start(5f, 0f);
        }

        void OnFrame(ARCameraFrameEventArgs args)
        {
            m_Manifest.summary.framesSeen++;
            if (Time.unscaledTime < m_NextEvaluate) return;
            m_NextEvaluate = Time.unscaledTime + evaluateEverySeconds;
            if (m_Manifest.summary.framesSelected >= maxSelectedFrames) { LastMessage = "Frame limit reached; stop and start a new capture."; return; }
            if (!cameraManager.TryAcquireLatestCpuImage(out XRCpuImage image)) return;

            using (image)
            {
                int index = m_Manifest.frames.Count;
                var f = new CaptureFrameRecord { frameId = m_Manifest.session.captureId + "-f" + index.ToString("D5", CultureInfo.InvariantCulture) };
                double rt = Time.realtimeSinceStartupAsDouble;
                f.timing.sensorTimestampNs = args.timestampNs ?? -1;
                f.timing.cpuImageTimestampSeconds = image.timestamp;
                f.timing.realtimeSeconds = rt;
                f.timing.utcEstimate = Iso(DateTime.Parse(m_Manifest.timing.startUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal)
                    .AddSeconds(rt - m_Manifest.timing.startRealtimeSeconds));

                FillPose(f.pose);
                FillGnss(f.positionPrior);
                Measure(image, f.quality);

                var cam = Camera.main != null ? Camera.main.transform : null;
                if (cam != null && m_HasLastSelected)
                {
                    f.quality.translationSinceLastSelectedMeters = Vector3.Distance(cam.position, m_LastPos);
                    f.quality.rotationSinceLastSelectedDegrees = Quaternion.Angle(cam.rotation, m_LastRot);
                }

                bool tracking = ARSession.state == ARSessionState.SessionTracking && ARSession.notTrackingReason == NotTrackingReason.None;
                if (!tracking) Reject(f, "tracking not normal: " + ARSession.notTrackingReason);
                else if (f.quality.sharpnessLaplacianVariance < minSharpness) Reject(f, "blur below threshold");
                else if (m_HasLastSelected && f.quality.translationSinceLastSelectedMeters < minTranslationMeters && f.quality.rotationSinceLastSelectedDegrees < minRotationDegrees)
                    Reject(f, "too little motion since last selected frame");
                else
                {
                    f.selected = true;
                    f.reason = m_HasLastSelected ? "motion and sharpness thresholds met" : "first tracked sharp frame";
                    SavePixels(image, f);
                    if (saveDepth) SaveDepth(f);
                    if (cam != null) { m_LastPos = cam.position; m_LastRot = cam.rotation; m_HasLastSelected = true; }
                    m_Manifest.summary.framesSelected++;
                }

                m_Manifest.frames.Add(f);
                if (m_Manifest.frames.Count % 10 == 0) WriteManifest(); // crash safety
            }
        }

        void Reject(CaptureFrameRecord f, string why)
        {
            f.selected = false;
            f.reason = why;
            m_Manifest.summary.framesRejected++;
        }

        void SavePixels(XRCpuImage image, CaptureFrameRecord f)
        {
            // MirrorX: XRCpuImage rows are top-down, Unity's encoder expects bottom-up. Mirroring keeps the
            // saved JPEG in native sensor row order so the platform intrinsics apply to it unchanged.
            var p = new XRCpuImage.ConversionParams(image, TextureFormat.RGBA32, XRCpuImage.Transformation.MirrorX);
            int size = image.GetConvertedDataSize(p);
            var buffer = new NativeArray<byte>(size, Allocator.Temp);
            try
            {
                image.Convert(p, buffer);
                byte[] jpg = ImageConversion.EncodeArrayToJPG(buffer.ToArray(), GraphicsFormat.R8G8B8A8_SRGB, (uint)image.width, (uint)image.height, 0, jpegQuality);
                string rel = "frames/" + f.frameId + ".jpg";
                File.WriteAllBytes(Path.Combine(CaptureFolder, rel), jpg);
                f.pixels.file = rel;
                f.pixels.width = image.width;
                f.pixels.height = image.height;
                f.pixels.sourceFormat = image.format.ToString();
                f.integrity.sha256 = Sha256(jpg);
            }
            finally { buffer.Dispose(); }

            if (cameraManager.TryGetIntrinsics(out XRCameraIntrinsics k))
            {
                var ki = f.pixels.intrinsics;
                ki.available = true;
                ki.reportedWidth = k.resolution.x;
                ki.reportedHeight = k.resolution.y;
                float sx = k.resolution.x > 0 ? (float)image.width / k.resolution.x : 1f;
                float sy = k.resolution.y > 0 ? (float)image.height / k.resolution.y : 1f;
                ki.scaledToSavedImage = !Mathf.Approximately(sx, 1f) || !Mathf.Approximately(sy, 1f);
                ki.fx = k.focalLength.x * sx; ki.fy = k.focalLength.y * sy;
                ki.cx = k.principalPoint.x * sx; ki.cy = k.principalPoint.y * sy;
            }
        }

        void SaveDepth(CaptureFrameRecord f)
        {
            var d = f.depth;
            d.source = DepthSource();
            if (d.source == "none" || occlusionManager == null) return;
            if (!occlusionManager.TryAcquireEnvironmentDepthCpuImage(out XRCpuImage depth)) { d.source = "none"; return; }
            using (depth)
            {
                var plane = depth.GetPlane(0);
                byte[] bytes = plane.data.ToArray();
                string rel = "depth/" + f.frameId + ".bin";
                File.WriteAllBytes(Path.Combine(CaptureFolder, rel), bytes);
                d.file = rel;
                d.format = depth.format.ToString();
                d.units = depth.format == XRCpuImage.Format.DepthFloat32 ? "meters (float32)"
                        : depth.format == XRCpuImage.Format.DepthUint16 ? "millimeters (uint16)" : "unknown";
                d.width = depth.width; d.height = depth.height; d.rowStride = plane.rowStride;
                d.timestampSeconds = depth.timestamp;
                f.integrity.depthSha256 = Sha256(bytes);
            }
            if (occlusionManager.TryAcquireEnvironmentDepthConfidenceCpuImage(out XRCpuImage conf))
            {
                using (conf)
                {
                    string rel = "depth/" + f.frameId + ".confidence.bin";
                    File.WriteAllBytes(Path.Combine(CaptureFolder, rel), conf.GetPlane(0).data.ToArray());
                    d.confidenceFile = rel;
                }
            }
        }

        /// <summary>
        /// iOS environment depth exists only on LiDAR devices (ARKit scene depth), so it is sensor depth.
        /// ARCore's Depth API is depth-from-motion, possibly fused with a ToF sensor the app cannot see: estimated.
        /// Human-segmentation depth alone is a learned estimate and is not saved as scene depth.
        /// </summary>
        string DepthSource()
        {
            if (occlusionManager == null || occlusionManager.descriptor == null) return "none";
            if (occlusionManager.currentEnvironmentDepthMode == EnvironmentDepthMode.Disabled) return "none";
#if UNITY_IOS
            return "sensor-lidar";
#else
            return "estimated";
#endif
        }

        void FillPose(FramePose p)
        {
            var cam = Camera.main != null ? Camera.main.transform : null;
            if (cam != null)
            {
                p.cameraToSessionPosition = V(cam.position);
                p.cameraToSessionRotationXyzw = Q(cam.rotation);
                if (anchorProvider != null && anchorProvider.TryGetAnchor(out var a))
                {
                    var inv = Quaternion.Inverse(a.pose.rotation);
                    p.anchorAvailable = true;
                    p.anchorQuality = a.quality.ToString();
                    p.cameraInAnchorPosition = V(inv * (cam.position - a.pose.position));
                    p.cameraInAnchorRotationXyzw = Q(inv * cam.rotation);
                }
            }
            p.sessionState = ARSession.state.ToString();
            p.notTrackingReason = ARSession.notTrackingReason.ToString();
            p.sessionOriginResets = m_OriginResets;
        }

        static void FillGnss(PositionPrior g)
        {
            if (Input.location.status != LocationServiceStatus.Running) return;
            var d = Input.location.lastData;
            g.available = true;
            g.latitude = d.latitude; g.longitude = d.longitude; g.altitude = d.altitude;
            g.horizontalAccuracyMeters = d.horizontalAccuracy;
            g.verticalAccuracyMeters = d.verticalAccuracy;
            g.fixTimestampSeconds = d.timestamp;
#if UNITY_IOS
            g.altitudeReference = "CoreLocation altitude (mean sea level) as passed through Unity; unverified";
#elif UNITY_ANDROID
            g.altitudeReference = "Android Location altitude (WGS84 ellipsoid) as passed through Unity; unverified";
#endif
        }

        /// <summary>Sharpness and exposure from the luma plane (plane 0 on both ARKit and ARCore camera images).</summary>
        static void Measure(XRCpuImage image, FrameQuality q)
        {
            if (image.planeCount < 1) return;
            var plane = image.GetPlane(0);
            var data = plane.data;
            int w = image.width, h = image.height, rs = plane.rowStride, ps = Mathf.Max(1, plane.pixelStride);
            const int step = 4;
            double sum = 0, sumSq = 0, lumaSum = 0;
            int n = 0, dark = 0, bright = 0;
            for (int y = step; y < h - step; y += step)
            {
                for (int x = step; x < w - step; x += step)
                {
                    int c = data[y * rs + x * ps];
                    int lap = 4 * c - data[(y - step) * rs + x * ps] - data[(y + step) * rs + x * ps]
                                    - data[y * rs + (x - step) * ps] - data[y * rs + (x + step) * ps];
                    sum += lap; sumSq += (double)lap * lap; lumaSum += c; n++;
                    if (c <= 8) dark++; else if (c >= 247) bright++;
                }
            }
            if (n == 0) return;
            double mean = sum / n;
            q.sharpnessLaplacianVariance = (float)(sumSq / n - mean * mean);
            q.meanLuma = (float)(lumaSum / n);
            q.clippedDarkFraction = (float)dark / n;
            q.clippedBrightFraction = (float)bright / n;
        }

        void FillDevice(DeviceProfile d)
        {
            d.model = SystemInfo.deviceModel;
            d.operatingSystem = SystemInfo.operatingSystem;
            d.platform = Application.platform.ToString();
            d.appVersion = Application.version;
            d.unityVersion = Application.unityVersion;
            var cfg = cameraManager.currentConfiguration;
            if (cfg.HasValue)
            {
                d.cameraConfigWidth = cfg.Value.width;
                d.cameraConfigHeight = cfg.Value.height;
                d.cameraConfigFramerate = cfg.Value.framerate ?? -1;
            }
            if (occlusionManager != null && occlusionManager.descriptor != null)
            {
                d.environmentDepthSupport = occlusionManager.descriptor.environmentDepthImageSupported.ToString();
                d.humanDepthSupport = occlusionManager.descriptor.humanSegmentationDepthImageSupported.ToString();
            }
            d.imageTrackingSupported = trackedImageManager != null && trackedImageManager.descriptor != null ? "Supported" : "Unsupported";
        }

        void WriteManifest()
        {
            if (m_Manifest == null || CaptureFolder == null) return;
            File.WriteAllText(Path.Combine(CaptureFolder, "manifest.json"), JsonUtility.ToJson(m_Manifest, true));
        }

        static string Iso(DateTime utc) => utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        static float[] V(Vector3 v) => new[] { v.x, v.y, v.z };
        static float[] Q(Quaternion q) => new[] { q.x, q.y, q.z, q.w };

        static string Sha256(byte[] bytes)
        {
            using (var sha = SHA256.Create()) return McClusterApi.ToHex(sha.ComputeHash(bytes));
        }
    }
}
