using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace McCluster.AR
{
    /// <summary>
    /// Phase A anchor: a printed marker (tools/ar/generate-marker.mjs, 180 mm) taped flat to a wall the owner
    /// controls, at a point whose position on the facade was measured with a tape. AR Foundation's
    /// ARTrackedImageManager finds the marker; once found, world tracking keeps its pose while the person
    /// steps back to see the whole facade (an A4-sized marker is not re-detected at 10 m, and does not need to be).
    ///
    /// AR Foundation reports a tracked image with its local XZ plane on the image and +Y out of the image
    /// (toward the viewer for a wall-mounted print). The image's "up" is taken as +Z. That last convention is
    /// not written down in the package documentation, so <see cref="markerRollDegrees"/> and
    /// <see cref="flipNormal"/> exist to correct it on the first device test without a rebuild of the logic.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ImageMarkerAnchorProvider : AnchorProvider
    {
        [SerializeField] ARTrackedImageManager trackedImageManager;

        [Tooltip("Name of the image in the XR Reference Image Library. Must match tools/ar/generate-marker.mjs.")]
        [SerializeField] string markerName = "mccluster-ar-marker-01";

        [Tooltip("Rotation about the wall normal applied to the marker frame, degrees. Use 90/180/270 if the facade appears rotated on device.")]
        [SerializeField] float markerRollDegrees = 0f;

        [Tooltip("Flip if the facade appears behind the wall instead of on it.")]
        [SerializeField] bool flipNormal = false;

        bool m_Locked;
        AnchorSample m_Last;
        string m_Status = "Point the camera at the printed marker.";

        public override string ProviderId => "image-marker";
        public override bool IsSupported => trackedImageManager != null && trackedImageManager.descriptor != null;
        public override string StatusText => m_Status;

        public override bool TryGetAnchor(out AnchorSample sample)
        {
            sample = m_Last;
            return m_Locked;
        }

        public override void ResetAnchor()
        {
            m_Locked = false;
            m_Last = default;
            m_Status = "Point the camera at the printed marker.";
        }

        void Update()
        {
            if (trackedImageManager == null)
            {
                m_Status = "No ARTrackedImageManager is wired to the marker provider.";
                return;
            }

            ARTrackedImage found = null;
            foreach (var image in trackedImageManager.trackables)
            {
                if (image.referenceImage.name == markerName) { found = image; break; }
            }

            if (found == null)
            {
                if (m_Locked)
                {
                    // The platform removed the image. Keep the last pose but stop vouching for it.
                    m_Last.quality = AnchorQuality.None;
                    m_Status = "Marker lost. Point the camera at it again.";
                }
                return;
            }

            var quality = found.trackingState == TrackingState.Tracking ? AnchorQuality.Tracking
                        : found.trackingState == TrackingState.Limited ? AnchorQuality.Limited
                        : AnchorQuality.None;

            // Only lock from an active observation; a Limited first sighting is not a measurement.
            if (!m_Locked && quality != AnchorQuality.Tracking) return;

            m_Last.anchorId = markerName;
            m_Last.providerId = ProviderId;
            m_Last.pose = FacadeFrame(found.transform);
            m_Last.quality = quality;
            m_Last.measuredSizeMeters = found.size;
            if (quality == AnchorQuality.Tracking) m_Last.lastTrackingTime = Time.time;
            m_Locked = true;

            m_Status = quality == AnchorQuality.Tracking
                ? "Marker locked."
                : "Marker out of view; holding its position from world tracking.";
        }

        /// <summary>Converts the tracked image transform into the facade frame (+X right, +Y up, +Z into the wall).</summary>
        Pose FacadeFrame(Transform image)
        {
            Vector3 outOfImage = flipNormal ? -image.up : image.up;   // image normal, toward the viewer
            Vector3 imageUp = image.forward;                           // image +Z read as the print's top edge
            Quaternion frame = Quaternion.LookRotation(-outOfImage, imageUp);
            frame = frame * Quaternion.AngleAxis(markerRollDegrees, Vector3.forward);
            return new Pose(image.position, frame);
        }
    }
}
