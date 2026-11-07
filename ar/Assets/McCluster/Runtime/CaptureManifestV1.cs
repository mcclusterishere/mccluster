using System;
using System.Collections.Generic;

namespace McCluster.AR
{
    // CaptureManifestV1 — DRAFT shape, written by CaptureSession as manifest.json beside the saved frames.
    //
    // Follows the capture-manifest table in the AR addendum (§4): session, timing, stored pixels, pose,
    // position prior, depth, quality, integrity/lineage.
    //
    // TODO(capture-contract): implement the canonical contract in docs/spatial/CAPTURE-MANIFEST.md.
    // This device-local pilot record is NOT mccluster.spatial.capture-manifest.v1 and must remain rejected
    // by packages/spatial-capture/validate.mjs. Do not change the schema id without implementing and
    // validating consent, mission linkage, retention, timing uncertainty, poses and depth conventions.
    // Unknown device measurements must be measured, not filled with invented canonical defaults.
    //
    // Rules this shape encodes:
    //  - depth.source is one of "sensor-lidar", "estimated", "none". Never conflated: Android Depth API
    //    output is "estimated" even where the phone fuses a ToF sensor, because the app cannot tell.
    //  - pixels are CLEAN camera frames from ARCameraManager.TryAcquireLatestCpuImage: acquired from the
    //    camera, never from the rendered screen, so fictional storefronts cannot enter reconstruction input.
    //  - unknowns are written as "unknown"/-1, never guessed.
    // JsonUtility cannot write nulls or dictionaries, hence sentinels and plain lists.

    [Serializable]
    public sealed class CaptureManifestV1
    {
        public string schema = "mccluster.capture-manifest.v1-draft";
        public string contractStatus = "local-only pilot draft; NOT compatible with mccluster.spatial.capture-manifest.v1; see docs/spatial/CAPTURE-MANIFEST.md; never upload or use for reconstruction";
        public CaptureSessionRecord session = new CaptureSessionRecord();
        public CaptureTimingRecord timing = new CaptureTimingRecord();
        public List<CaptureFrameRecord> frames = new List<CaptureFrameRecord>();
        public CaptureSummary summary = new CaptureSummary();
    }

    [Serializable]
    public sealed class CaptureSessionRecord
    {
        public string captureId;
        public string missionRef = "";           // none in Phase A; later an existing action mission id
        public string runRef = "";               // later an existing /v1/live session id
        public DeviceProfile device = new DeviceProfile();
        public ConsentRecord consent = new ConsentRecord();
        public List<string> allowedUses = new List<string> { "owner-pilot-alignment-test" };
        public string retention = "device-local only; this build never uploads; delete after the Phase A pilot";
        public string composition = "none: frames are CPU camera images acquired before rendering; no virtual content can be present";
        public string anchorProvider;
        public string anchorId;
        public string processingVersion;
    }

    [Serializable]
    public sealed class DeviceProfile
    {
        public string model;
        public string operatingSystem;
        public string platform;
        public string appVersion;
        public string unityVersion;
        public int cameraConfigWidth = -1;
        public int cameraConfigHeight = -1;
        public int cameraConfigFramerate = -1;
        public string environmentDepthSupport = "unknown";   // Supported enum: Unknown / Unsupported / Supported
        public string humanDepthSupport = "unknown";
        public string imageTrackingSupported = "unknown";
    }

    [Serializable]
    public sealed class ConsentRecord
    {
        public bool spatialCaptureConsented;
        public string consentVersion = "phase-a-owner-pilot-0";
        public string consentedAtUtc;
    }

    [Serializable]
    public sealed class CaptureTimingRecord
    {
        public string startUtc;
        public double startRealtimeSeconds;
        public string clockNotes = "sensorTimestampNs is the platform camera clock; realtimeSeconds is Time.realtimeSinceStartupAsDouble; utcEstimate = startUtc + (realtime - startRealtime); synchronization uncertainty unmeasured";
    }

    [Serializable]
    public sealed class CaptureFrameRecord
    {
        public string frameId;
        public bool selected;
        public string reason;                    // why selected or rejected
        public FrameTiming timing = new FrameTiming();
        public FramePixels pixels = new FramePixels();
        public FramePose pose = new FramePose();
        public PositionPrior positionPrior = new PositionPrior();
        public FrameDepth depth = new FrameDepth();
        public FrameQuality quality = new FrameQuality();
        public FrameIntegrity integrity = new FrameIntegrity();
    }

    [Serializable]
    public sealed class FrameTiming
    {
        public long sensorTimestampNs = -1;
        public double cpuImageTimestampSeconds = -1;
        public double realtimeSeconds;
        public string utcEstimate;
    }

    [Serializable]
    public sealed class FramePixels
    {
        public string file = "";                 // relative to the capture folder; empty when rejected
        public string encoding = "jpeg";
        public int width;
        public int height;
        public string sourceFormat;              // XRCpuImage.Format of the camera image
        public string transformation = "MirrorX for Unity's bottom-up encoder, so the file is in native sensor row order";
        public string pixelOrigin = "top-left, native sensor orientation (landscape); not rotated to the screen";
        public string lensId = "unknown";
        public string digitalZoom = "none-known";
        public string stabilization = "none-known";
        public string distortion = "not-provided-by-platform";
        public CameraIntrinsics intrinsics = new CameraIntrinsics();
    }

    [Serializable]
    public sealed class CameraIntrinsics
    {
        public bool available;
        public float fx, fy, cx, cy;             // pixels, for the SAVED image
        public int reportedWidth, reportedHeight; // XRCameraIntrinsics.resolution
        public bool scaledToSavedImage;          // true when reported resolution differed and values were scaled
    }

    [Serializable]
    public sealed class FramePose
    {
        public string axes = "Unity: left-handed, +Y up, +Z camera forward, meters; session space = AR session origin";
        public float[] cameraToSessionPosition = new float[3];
        public float[] cameraToSessionRotationXyzw = new float[4];
        public bool anchorAvailable;
        public string anchorQuality = "None";
        public float[] cameraInAnchorPosition = new float[3];
        public float[] cameraInAnchorRotationXyzw = new float[4];
        public string sessionState;
        public string notTrackingReason;
        public int sessionOriginResets;
        public string poseTiming = "camera transform read on the frameReceived callback; offset from image exposure unmeasured";
    }

    [Serializable]
    public sealed class PositionPrior
    {
        public bool available;
        public string source = "Unity LocationService (platform GNSS/fused)";
        public double latitude, longitude, altitude;
        public float horizontalAccuracyMeters = -1, verticalAccuracyMeters = -1;
        public double fixTimestampSeconds = -1;   // LocationInfo.timestamp, seconds since 1970
        public string altitudeReference = "unknown";
    }

    [Serializable]
    public sealed class FrameDepth
    {
        public string source = "none";           // "sensor-lidar" | "estimated" | "none"
        public string file = "";
        public string format = "";
        public string units = "";
        public int width, height, rowStride;
        public string confidenceFile = "";
        public string valueConvention = "unverified (camera-Z vs ray distance not confirmed for this platform)";
        public string alignment = "covers the full camera image at lower resolution; registration unverified";
        public double timestampSeconds = -1;
    }

    [Serializable]
    public sealed class FrameQuality
    {
        public float sharpnessLaplacianVariance = -1; // luma, subsampled; uncalibrated
        public float meanLuma = -1;                   // 0..255
        public float clippedDarkFraction = -1, clippedBrightFraction = -1;
        public float translationSinceLastSelectedMeters = -1, rotationSinceLastSelectedDegrees = -1;
        public string overlap = "not computed in Phase A";
        public string featureCoverage = "not computed in Phase A";
        public string dynamicPrivateMasks = "none applied in Phase A";
    }

    [Serializable]
    public sealed class FrameIntegrity
    {
        public string sha256 = "";
        public string depthSha256 = "";
        public string uploadReceipt = "";        // no upload in Phase A
        public List<string> sourceFrameIds = new List<string>();
        public List<string> derivedArtifactIds = new List<string>();
    }

    [Serializable]
    public sealed class CaptureSummary
    {
        public int framesSeen, framesSelected, framesRejected;
        public string stopUtc;
        public bool closedCleanly;
    }
}
