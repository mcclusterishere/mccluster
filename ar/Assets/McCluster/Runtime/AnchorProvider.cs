using System;
using UnityEngine;

namespace McCluster.AR
{
    /// <summary>How much an anchor can be trusted this frame.</summary>
    public enum AnchorQuality
    {
        /// <summary>No usable pose: never found, or the provider dropped it.</summary>
        None = 0,
        /// <summary>A pose exists but the provider is not actively observing it (stale, estimated, out of view).</summary>
        Limited = 1,
        /// <summary>The provider is actively observing the anchor.</summary>
        Tracking = 2,
    }

    /// <summary>
    /// One anchor observation. <see cref="pose"/> is the FACADE FRAME in Unity world (AR session) space:
    /// origin at the anchor point on the wall, +X to the right along the wall, +Y up, +Z INTO the wall,
    /// meters. Content placed at negative Z sits in front of the wall, facing the viewer.
    /// </summary>
    [Serializable]
    public struct AnchorSample
    {
        public string anchorId;            // stable id of the physical anchor (marker name, or later a map anchor id)
        public string providerId;          // "image-marker", "geospatial"
        public Pose pose;
        public AnchorQuality quality;
        public float lastTrackingTime;     // Time.time of the last Tracking observation, -1 if never
        public Vector2 measuredSizeMeters; // provider's physical size estimate (marker extents); zero when not applicable
    }

    /// <summary>
    /// One way of finding where the storefront belongs. Phase A ships <see cref="ImageMarkerAnchorProvider"/>
    /// (a printed marker at a measured point on a wall the owner controls). <see cref="GeospatialAnchorProvider"/>
    /// is the later mode behind the same contract. FacadeSkin and CaptureSession only ever see this class.
    /// It is an abstract MonoBehaviour rather than an interface so the Inspector can wire it.
    /// </summary>
    public abstract class AnchorProvider : MonoBehaviour
    {
        /// <summary>Short machine id written into capture manifests.</summary>
        public abstract string ProviderId { get; }

        /// <summary>False when the device or build cannot run this provider at all.</summary>
        public abstract bool IsSupported { get; }

        /// <summary>One plain sentence for the HUD.</summary>
        public abstract string StatusText { get; }

        /// <summary>True once an anchor has been found at least once and not reset.</summary>
        public abstract bool TryGetAnchor(out AnchorSample sample);

        /// <summary>Forget the current anchor and search again.</summary>
        public abstract void ResetAnchor();
    }
}
