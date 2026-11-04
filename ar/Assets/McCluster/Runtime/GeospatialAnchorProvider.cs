using UnityEngine;

namespace McCluster.AR
{
    /// <summary>
    /// LATER MODE — a stub so FacadeSkin and CaptureSession are already written against the shared contract.
    /// It compiles without ARCore Extensions and always reports unsupported.
    ///
    /// When the real building is chosen, this provider will:
    ///  1. require ARCore Extensions for AR Foundation (installed separately from a Git URL pinned to a
    ///     release tag, see ar/README.md; it is NOT in Packages/manifest.json on purpose) and the scripting
    ///     define MCCLUSTER_ARCORE_EXTENSIONS;
    ///  2. use a Google Cloud project with the ARCore API enabled. Keyless authorization is preferred; an API
    ///     key, if ever used, is entered in Project Settings by the owner and never committed;
    ///  3. check AREarthManager.IsGeospatialModeSupported, wait for an Earth tracking state with acceptable
    ///     horizontal/heading accuracy, then resolve a terrain/rooftop or WGS84 anchor at the surveyed facade
    ///     point and report it through <see cref="AnchorSample"/> in the same facade frame;
    ///  4. record provider-derived depth/geometry as provider data, never as locally sensed depth.
    /// Facade mode must stay gated on the measured alignment targets in ar/README.md, not on a GPS fix.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GeospatialAnchorProvider : AnchorProvider
    {
        [Tooltip("Surveyed facade anchor, WGS84 degrees. Unset until the owner chooses and measures the real building.")]
        [SerializeField] double latitude;
        [SerializeField] double longitude;
        [Tooltip("Meters. Convention (ellipsoid vs terrain-relative) to be fixed when this is implemented.")]
        [SerializeField] double altitude;
        [Tooltip("Facade normal heading, degrees clockwise from true north, pointing out of the wall.")]
        [SerializeField] float facadeHeadingDegrees;

        public override string ProviderId => "geospatial";

#if MCCLUSTER_ARCORE_EXTENSIONS
        // Implementation lands with Phase A's geospatial follow-up; keep the stub honest until then.
        public override bool IsSupported => false;
        public override string StatusText => "Geospatial anchoring is installed but not implemented in this build.";
#else
        public override bool IsSupported => false;
        public override string StatusText => "Geospatial anchoring needs ARCore Extensions (not installed in this build).";
#endif

        public override bool TryGetAnchor(out AnchorSample sample)
        {
            sample = default;
            return false;
        }

        public override void ResetAnchor() { }
    }
}
