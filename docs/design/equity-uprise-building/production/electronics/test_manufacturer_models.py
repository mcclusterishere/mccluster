"""Exterior/reference regressions, not evidence of floor or browser approval."""
import io
import json
import unittest
from urllib.parse import urlparse

import numpy as np
import trimesh

from manufacturer_models import build_manufacturer_model, load_catalog, METRES_TO_FEET


# Independent normalized manufacturer W,D,H envelope assertions.
EXPECTED_METRES = {
    "dell-pro-precision-9-t6-pw9t6260": (.2941, .6175, .4498),
    "apple-mac-studio-m5-ultra": (.197, .197, .095),
    "framework-desktop-ryzen-ai-max-plus-pro-495-192gb": (.0968, .2055, .2261),
    "lenovo-thinkstation-px": (.220, .575, .4404),
    "hp-z8-fury-g6i-standard-panel": (.2195, .559, .4451),
    "system76-thelio-major-r5-n4": (.254, .384, .440),
    "asus-expertcenter-pro-et900n-g3": (.232, .584, .565),
    "asus-proart-p16-h7606wx-rtx5090-closed": (.3549, .2469, .0183),
}


class ManufacturerModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()
        cls.models = {key: build_manufacturer_model(key) for key in EXPECTED_METRES}

    def test_catalog_is_exactly_the_supported_reference_set(self):
        ids = [e["model_id"] for e in self.catalog["models"]]
        self.assertEqual(set(ids), set(EXPECTED_METRES))
        self.assertEqual(len(ids), len(set(ids)))

    def test_unknown_ids_fail_closed(self):
        for bad in ("Dell", "generic", "nvidia-dgx-station", "apple-mac-studio", "", None, []):
            with self.subTest(model_id=bad), self.assertRaises(ValueError):
                build_manufacturer_model(bad)

    def test_manufacturer_dimensions_and_axis_order(self):
        for key, expected in EXPECTED_METRES.items():
            with self.subTest(model_id=key):
                model = self.models[key]
                np.testing.assert_allclose(model.envelope_ft,
                    np.array(expected) / .3048, rtol=0, atol=1e-12)
                self.assertEqual(model.metadata["axis_order"], ["width", "depth", "height"])
                self.assertEqual(model.metadata["units"], "feet")
                self.assertEqual(model.metadata["front_axis"], "-Y")
                self.assertEqual(model.metadata["up_axis"], "+Z")

    def test_complete_envelope_centered_and_supported(self):
        for key, model in self.models.items():
            with self.subTest(model_id=key):
                mesh = trimesh.util.concatenate(list(model.components.values()))
                np.testing.assert_allclose(mesh.bounds, model.bounds_ft, rtol=0, atol=1e-10)
                self.assertAlmostEqual(model.components["CHASSIS"].bounds[0, 2], 0, places=10)

    def test_no_detail_or_foot_inflates_published_envelope(self):
        for key, model in self.models.items():
            for name, mesh in model.components.items():
                with self.subTest(model_id=key, component=name):
                    self.assertTrue(np.all(mesh.bounds[0] >= model.bounds_ft[0] - 1e-10))
                    self.assertTrue(np.all(mesh.bounds[1] <= model.bounds_ft[1] + 1e-10))

    def test_finite_non_degenerate_geometry_with_explicit_colours(self):
        for model in self.models.values():
            for name, mesh in model.components.items():
                with self.subTest(model_id=model.model_id, component=name):
                    self.assertGreater(len(mesh.vertices), 0)
                    self.assertTrue(np.isfinite(mesh.vertices).all())
                    self.assertTrue(np.isfinite(mesh.face_normals).all())
                    self.assertTrue(np.all(mesh.area_faces > 1e-15))
                    self.assertEqual(mesh.visual.face_colors.shape, (len(mesh.faces), 4))
                    self.assertEqual(mesh.metadata["model_id"], model.model_id)

    def test_small_batched_mesh_budget(self):
        for key, model in self.models.items():
            with self.subTest(model_id=key):
                self.assertLessEqual(len(model.components), 12)
                self.assertLessEqual(sum(len(x.faces) for x in model.components.values()), 6000)
                self.assertTrue(all(name == name.upper() and " " not in name for name in model.components))

    def test_deterministic_and_independent_builds(self):
        for key, original in self.models.items():
            again = build_manufacturer_model(key)
            self.assertEqual(original.metadata, again.metadata)
            self.assertEqual(list(original.components), list(again.components))
            for name in original.components:
                a, b = original.components[name], again.components[name]
                np.testing.assert_array_equal(a.vertices, b.vertices)
                np.testing.assert_array_equal(a.faces, b.faces)
                np.testing.assert_array_equal(a.visual.face_colors, b.visual.face_colors)
            again.components["CHASSIS"].apply_translation([10, 10, 10])
            again.metadata["sources"].clear()
            self.assertNotEqual(original.metadata, again.metadata)
            self.assertLess(original.components["CHASSIS"].bounds[0, 2], 1)

    def test_source_and_uncertainty_metadata_are_explicit(self):
        domains = {"www.dell.com", "www.apple.com", "frame.work", "github.com",
                   "psref.lenovo.com", "www8.hp.com", "www.hp.com", "system76.com", "www.asus.com",
                   "dlcdnwebimgs.asus.com", "dl.dell.com", "guides.frame.work", "knowledgebase.frame.work"}
        for entry in self.catalog["models"]:
            self.assertTrue(entry["sources"])
            self.assertTrue(entry["uncertainties"])
            self.assertIn("schematic visual details", entry["fidelity"])
            for source in entry["sources"]:
                self.assertEqual(urlparse(source["url"]).scheme, "https")
                self.assertIn(urlparse(source["url"]).hostname, domains)
                self.assertTrue(source["supports"])

    def test_no_model_implies_received_sponsored_live_or_serviceable(self):
        for model in self.models.values():
            meta = model.metadata
            self.assertEqual(meta["sponsor_status"], "unconfirmed_prospect")
            self.assertEqual(meta["physical_asset_status"], "not_received")
            self.assertEqual(meta["live_connection_status"], "not_connected")
            self.assertFalse(meta["vendor_approved"])
            self.assertFalse(meta["live_host"])
            self.assertFalse(meta["serviceable_internals"])
            self.assertTrue(meta["exterior_only"])

    def test_no_logos_or_training_internals_are_generated(self):
        forbidden = {"LOGO", "WORDMARK", "CPU", "MOTHERBOARD", "RAM", "DIMM", "SSD", "GPU"}
        for model in self.models.values():
            self.assertFalse(set(model.components) & forbidden)
            self.assertTrue(all("LOGO" not in name and "WORDMARK" not in name for name in model.components))
            self.assertTrue(all(mesh.visual.kind == "face" for mesh in model.components.values()))

    def test_do_not_invent_gpu_connectors_for_unspecified_cards(self):
        for key in ("dell-pro-precision-9-t6-pw9t6260", "lenovo-thinkstation-px",
                    "hp-z8-fury-g6i-standard-panel", "system76-thelio-major-r5-n4"):
            self.assertNotIn("DISPLAY_OUTPUTS", self.models[key].components)

    def test_apple_has_correct_front_and_rear_ports_and_no_added_height(self):
        model = self.models["apple-mac-studio-m5-ultra"]
        front = model.metadata["component_features"]["FRONT_IO"]
        rear = model.metadata["component_features"]["REAR_IO"]
        self.assertEqual([p["kind"] for p in front].count("thunderbolt_5_usb_c"), 2)
        self.assertEqual([p["kind"] for p in front].count("sdxc"), 1)
        self.assertEqual([p["kind"] for p in rear].count("thunderbolt_5_usb_c"), 4)
        self.assertEqual([p["kind"] for p in rear].count("usb_a"), 2)
        self.assertAlmostEqual(model.envelope_ft[2] / METRES_TO_FEET, .095)

    def test_framework_mapping_and_configurable_front_cards_stay_explicit(self):
        model = self.models["framework-desktop-ryzen-ai-max-plus-pro-495-192gb"]
        self.assertTrue(any("inferred" in s for s in model.metadata["uncertainties"]))
        self.assertIn("EXPANSION_CARD_SLOTS", model.components)
        self.assertNotIn("EXPANSION_CARD_SLOTS", model.metadata["component_features"])
        ports = model.metadata["component_features"]["DISPLAY_OUTPUTS"]
        self.assertEqual([x["kind"] for x in ports].count("displayport"), 2)
        self.assertEqual([x["kind"] for x in ports].count("hdmi"), 1)

    def test_exact_asus_oem_and_closed_laptop_boundaries(self):
        station = self.models["asus-expertcenter-pro-et900n-g3"]
        self.assertEqual(station.metadata["manufacturer"], "ASUS")
        self.assertIn("DGX Station architecture", station.metadata["configuration"])
        self.assertIn("complete installed height unverified", station.metadata["dimension_extent_status"])
        laptop = self.models["asus-proart-p16-h7606wx-rtx5090-closed"]
        self.assertIn("LID", laptop.components)
        self.assertNotIn("DISPLAY_PANEL", laptop.components)
        self.assertNotIn("NIC_PORT", laptop.components)
        self.assertNotIn("POWER_SUPPLY", laptop.components)
        self.assertEqual(laptop.metadata["geometry_class"], "closed_laptop")

    def test_ports_are_on_declared_front_rear_or_side_and_schematic(self):
        for model in self.models.values():
            w, d, _ = np.array(model.envelope_ft) / METRES_TO_FEET
            for features in model.metadata["component_features"].values():
                for port in features:
                    self.assertTrue(port["schematic_position"])
                    x, y, _ = port["position_m"]
                    if port["face"] == "front":
                        self.assertAlmostEqual(y, -d / 2)
                    elif port["face"] == "rear":
                        self.assertAlmostEqual(y, d / 2)
                    else:
                        self.assertAlmostEqual(abs(x), w / 2)

    def test_glb_round_trip_preserves_component_names_and_scale(self):
        for key, model in self.models.items():
            scene = trimesh.Scene()
            for name, mesh in model.components.items():
                scene.add_geometry(mesh, geom_name=name, node_name=name)
            blob = scene.export(file_type="glb")
            reread = trimesh.load(io.BytesIO(blob), file_type="glb", force="scene")
            self.assertEqual(set(reread.geometry), set(model.components), key)
            np.testing.assert_allclose(reread.bounds, model.bounds_ft, rtol=0, atol=1e-6)

    def test_catalog_is_serializable_without_private_files_or_machine_state(self):
        text = json.dumps(self.catalog)
        for forbidden in ("/tmp/", "/workspace/", "serial_number", "api_key", "password"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
