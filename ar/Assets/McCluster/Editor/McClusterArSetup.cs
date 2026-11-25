using System.IO;
using McCluster.AR;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEditor.XR.ARSubsystems;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace McCluster.AR.EditorTools
{
    /// <summary>
    /// Two menu items that turn a fresh checkout into a buildable Phase A project, so nothing in
    /// ProjectSettings/ or a .unity scene has to be hand-written into Git:
    ///
    ///   McCluster > AR > 1. Apply player settings   (bundle id, OS minimums, IL2CPP/ARM64, purpose strings, XR loaders)
    ///   McCluster > AR > 2. Build tea facade scene  (marker library, material, AR rig, prefab, build list)
    ///
    /// Run 1, let Unity restart if it asks (input handling changes need it), then run 2. Both are idempotent.
    /// After the first successful run, commit the generated .meta files, ProjectSettings/*.asset, the scene,
    /// the prefab and the reference library so the next checkout opens ready to build.
    /// No signing team, certificate, provisioning profile, keystore or API key is ever set here.
    /// </summary>
    static class McClusterArSetup
    {
        const string BundleId = "org.mccluster.ar";
        const string Root = "Assets/McCluster";
        const string MarkerName = "mccluster-ar-marker-01";
        const float MarkerMeters = 0.18f; // must equal tools/ar/generate-marker.mjs physicalMeters
        const string MarkerPng = Root + "/Markers/" + MarkerName + ".png";
        const string LibraryPath = Root + "/Markers/MarkerLibrary.asset";
        const string MaterialPath = Root + "/Materials/Facade.mat";
        const string ScenePath = Root + "/Scenes/TeaFacade.unity";
        const string PrefabPath = Root + "/Prefabs/TeaFacadeRig.prefab";

        [MenuItem("McCluster/AR/1. Apply player settings")]
        static void ApplyPlayerSettings()
        {
            PlayerSettings.companyName = "McCluster Corp";
            PlayerSettings.productName = "McCluster AR";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.iOS, BundleId);
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, BundleId);
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;

            // iOS: ARKit, purpose strings shown by the system permission prompts.
            PlayerSettings.iOS.targetOSVersionString = "15.0";
            PlayerSettings.iOS.cameraUsageDescription = "The camera shows the street with a fictional storefront placed on the wall you choose.";
            PlayerSettings.iOS.locationUsageDescription = "Your location is saved with a capture only when you start one, and stays on this phone.";

            // Android: ARCore requires OpenGLES3 or Vulkan first; API 29 satisfies both paths of the ARCore build check.
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.OpenGLES3 });

            // Input handling "Both": AR Foundation's camera pose uses the Input System package; the GNSS prior
            // uses UnityEngine.LocationService, which lives on the legacy Input class.
            var playerSettings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset");
            if (playerSettings != null && playerSettings.Length > 0)
            {
                var so = new SerializedObject(playerSettings[0]);
                var handler = so.FindProperty("activeInputHandler");
                if (handler != null && handler.intValue != 2)
                {
                    handler.intValue = 2;
                    so.ApplyModifiedProperties();
                    Debug.Log("[McCluster AR] Active Input Handling set to Both. Restart the Editor when Unity asks.");
                }
            }

            AssignLoader(BuildTargetGroup.iOS, "UnityEngine.XR.ARKit.ARKitLoader");
            AssignLoader(BuildTargetGroup.Android, "UnityEngine.XR.ARCore.ARCoreLoader");
            AssetDatabase.SaveAssets();
            Debug.Log("[McCluster AR] Player settings applied for " + BundleId + ". Next: McCluster > AR > 2. Build tea facade scene.");
        }

        static void AssignLoader(BuildTargetGroup group, string loader)
        {
            var general = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(group);
            if (general == null || general.Manager == null)
            {
                Debug.LogWarning("[McCluster AR] XR settings for " + group + " do not exist yet. Open Project Settings > XR Plug-in Management once, select the " + group + " tab, tick " + (group == BuildTargetGroup.iOS ? "Apple ARKit" : "Google ARCore") + ", then run this again.");
                return;
            }
            if (!XRPackageMetadataStore.AssignLoader(general.Manager, loader, group))
                Debug.Log("[McCluster AR] " + loader + " already assigned (or could not be) for " + group + ".");
        }

        [MenuItem("McCluster/AR/2. Build tea facade scene")]
        static void BuildScene()
        {
            if (Resources.Load<TMPro.TMP_Settings>("TMP Settings") == null)
                Debug.LogWarning("[McCluster AR] TextMeshPro essential resources are not imported. Window > TextMeshPro > Import TMP Essential Resources, otherwise the storefront text will not draw.");

            foreach (var dir in new[] { "Materials", "Scenes", "Prefabs" })
                Directory.CreateDirectory(Path.Combine(Root, dir));
            AssetDatabase.Refresh();

            var library = BuildMarkerLibrary();
            var material = BuildMaterial();
            if (library == null || material == null) return;

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            new GameObject("AR Session", typeof(ARSession), typeof(ARInputManager));

            // XR Origin, as AR Foundation's own "XR Origin (Mobile AR)" menu builds it.
            var originGo = new GameObject("XR Origin", typeof(XROrigin));
            var offset = new GameObject("Camera Offset");
            offset.transform.SetParent(originGo.transform, false);
            var cameraGo = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener), typeof(ARCameraManager),
                typeof(ARCameraBackground), typeof(AROcclusionManager), typeof(TrackedPoseDriver));
            cameraGo.transform.SetParent(offset.transform, false);
            cameraGo.tag = "MainCamera";
            var camera = cameraGo.GetComponent<Camera>();
            camera.clearFlags = CameraClearFlags.Color;
            camera.backgroundColor = Color.black;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 60f; // a facade viewed from across a street
            var poseDriver = cameraGo.GetComponent<TrackedPoseDriver>();
            var position = new InputAction("Position", binding: "<XRHMD>/centerEyePosition", expectedControlType: "Vector3");
            position.AddBinding("<HandheldARInputDevice>/devicePosition");
            var rotation = new InputAction("Rotation", binding: "<XRHMD>/centerEyeRotation", expectedControlType: "Quaternion");
            rotation.AddBinding("<HandheldARInputDevice>/deviceRotation");
            poseDriver.positionInput = new InputActionProperty(position);
            poseDriver.rotationInput = new InputActionProperty(rotation);

            var origin = originGo.GetComponent<XROrigin>();
            origin.CameraFloorOffsetObject = offset;
            origin.Camera = camera;

            var images = originGo.AddComponent<ARTrackedImageManager>();
            Set(images, "m_SerializedLibrary", library);
            SetInt(images, "m_MaxNumberOfMovingImages", 1);

            // The McCluster rig.
            var rig = new GameObject("McCluster AR");
            var api = rig.AddComponent<McClusterApi>();
            var marker = rig.AddComponent<ImageMarkerAnchorProvider>();
            var geo = rig.AddComponent<GeospatialAnchorProvider>();
            geo.enabled = false;
            var facade = rig.AddComponent<FacadeSkin>();
            var capture = rig.AddComponent<CaptureSession>();
            var hud = rig.AddComponent<ArHud>();
            var occlusion = cameraGo.GetComponent<AROcclusionManager>();

            Set(marker, "trackedImageManager", images);
            Set(facade, "anchorProvider", marker);
            Set(facade, "api", api);
            Set(facade, "arCamera", camera);
            Set(facade, "occlusionManager", occlusion);
            Set(facade, "facadeMaterialTemplate", material);
            Set(capture, "cameraManager", cameraGo.GetComponent<ARCameraManager>());
            Set(capture, "occlusionManager", occlusion);
            Set(capture, "trackedImageManager", images);
            Set(capture, "anchorProvider", marker);
            Set(hud, "facade", facade);
            Set(hud, "capture", capture);
            Set(hud, "api", api);

            PrefabUtility.SaveAsPrefabAssetAndConnect(rig, PrefabPath, InteractionMode.AutomatedAction);
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("[McCluster AR] Built " + ScenePath + ". Build to a phone with File > Build Profiles (see ar/README.md).");
        }

        static XRReferenceImageLibrary BuildMarkerLibrary()
        {
            var importer = AssetImporter.GetAtPath(MarkerPng) as TextureImporter;
            if (importer == null)
            {
                Debug.LogError("[McCluster AR] Marker image missing at " + MarkerPng + ". Run: node tools/ar/generate-marker.mjs");
                return null;
            }
            importer.textureType = TextureImporterType.Default;
            importer.isReadable = true;
            importer.mipmapEnabled = false;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.SaveAndReimport();
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(MarkerPng);

            var library = AssetDatabase.LoadAssetAtPath<XRReferenceImageLibrary>(LibraryPath);
            if (library == null)
            {
                library = ScriptableObject.CreateInstance<XRReferenceImageLibrary>();
                AssetDatabase.CreateAsset(library, LibraryPath);
            }
            int index = -1;
            for (int i = 0; i < library.count; i++)
                if (library[i].name == MarkerName) { index = i; break; }
            if (index < 0)
            {
                library.Add();
                index = library.count - 1;
            }
            library.SetName(index, MarkerName);
            library.SetTexture(index, texture, true);
            library.SetSpecifySize(index, true);
            library.SetSize(index, new Vector2(MarkerMeters, MarkerMeters));
            EditorUtility.SetDirty(library);
            return library;
        }

        static Material BuildMaterial()
        {
            var shader = Shader.Find("McCluster/FacadeUnlit");
            if (shader == null)
            {
                Debug.LogError("[McCluster AR] Shader McCluster/FacadeUnlit not found; check Assets/McCluster/Resources.");
                return null;
            }
            var material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                material = new Material(shader) { name = "Facade" };
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            return material;
        }

        static void Set(Object target, string field, Object value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null) { Debug.LogError("[McCluster AR] " + target.GetType().Name + "." + field + " not found"); return; }
            p.objectReferenceValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void SetInt(Object target, string field, int value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null) { Debug.LogError("[McCluster AR] " + target.GetType().Name + "." + field + " not found"); return; }
            p.intValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
