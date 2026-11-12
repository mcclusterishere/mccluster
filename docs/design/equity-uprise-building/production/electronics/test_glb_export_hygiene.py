"""Regression and same-export semantic/BIN equivalence tests."""
import copy
import io
import hashlib
import json
from pathlib import Path
import struct
import unittest

from glb_export_hygiene import (
    clean_export_tree, clean_glb_bytes, read_glb, verify_export_equivalence,
)


def encode(tree, binary=b"\x01\x02\x03\x00", extra_chunks=()):
    payload = json.dumps(tree, separators=(",", ":")).encode()
    payload += b" " * (4 - len(payload) % 4)
    chunks = [(b"JSON", payload), (b"BIN\x00", binary), *extra_chunks]
    body = b"".join(struct.pack("<I4s", len(data), kind) + data for kind, data in chunks)
    return struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body


def fixture():
    primitive = {"attributes": {"POSITION": 0}, "indices": 1, "mode": 4, "material": 0}
    return {
        "asset": {"version": "2.0", "generator": "test"},
        "scene": 0, "scenes": [{"nodes": [0, 1, 2]}],
        "nodes": [
            {"name": "CABLE::STEP4A::00001::0", "mesh": 0, "translation": [1.25, 2, 3]},
            {"name": "F1-USER-MON-01::PART::BEZEL", "mesh": 1, "scale": [1, 2, 3]},
            {"name": "F4-USER-WS-01", "mesh": 2, "rotation": [0, 0, 0, 1]},
        ],
        "meshes": [
            {"name": "geometry_1234", "extras": {}, "primitives": [copy.deepcopy(primitive)]},
            {"name": "F1-USER-MON-01::PART::BEZEL", "extras": {
                "asset_id": "F1-USER-MON-01", "component_id": "BEZEL",
                "nested": {"keep": [1, 2, 3]}}, "primitives": [copy.deepcopy(primitive)]},
            {"name": "manufacturer::apple-mac-studio-m5-ultra::CHASSIS", "extras": {
                "model_id": "apple-mac-studio-m5-ultra", "exterior_only": True,
                "features": [{"schematic_position": True}]}, "primitives": [copy.deepcopy(primitive)]},
        ],
        "accessors": [{"bufferView": 0, "byteOffset": 0, "componentType": 5126,
                       "type": "VEC3", "count": 1, "min": [0, 0, 0], "max": [1, 1, 1]}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
        "buffers": [{"byteLength": 4}],
        "materials": [{"name": "Do not remove material name", "doubleSided": True,
                       "pbrMetallicRoughness": {"baseColorFactor": [.1, .2, .3, 1]}}],
    }


class ExportHygieneTest(unittest.TestCase):
    def test_exact_allowlist_and_counts(self):
        tree = fixture()
        self.assertEqual(clean_export_tree(tree), {"empty_mesh_extras": 1,
            "generated_cable_mesh_names": 1, "mesh_names_duplicating_sole_asset_node": 1})
        self.assertNotIn("name", tree["meshes"][0])
        self.assertNotIn("extras", tree["meshes"][0])
        self.assertNotIn("name", tree["meshes"][1])
        self.assertEqual(tree["meshes"][1]["extras"], fixture()["meshes"][1]["extras"])
        self.assertEqual(tree["meshes"][2], fixture()["meshes"][2])

    def test_nodes_accessors_materials_and_all_other_records_untouched(self):
        before = fixture()
        tree = copy.deepcopy(before)
        clean_export_tree(tree)
        for key in before.keys() - {"meshes"}:
            self.assertEqual(before[key], tree[key], key)
        for old, new in zip(before["meshes"], tree["meshes"]):
            self.assertEqual(old["primitives"], new["primitives"])

    def test_deterministic_and_idempotent(self):
        source = encode(fixture())
        a, proof = clean_glb_bytes(source)
        b, _ = clean_glb_bytes(source)
        self.assertEqual(a, b)
        second, repeat = clean_glb_bytes(a)
        self.assertEqual(second, a)
        self.assertEqual(repeat["saved_bytes"], 0)
        self.assertTrue(proof["passed"])

    def test_shared_device_mesh_name_is_retained(self):
        tree = fixture()
        tree["nodes"].append({"name": "F1-USER-MON-02::PART::BEZEL", "mesh": 1})
        original = copy.deepcopy(tree["meshes"][1])
        clean_export_tree(tree)
        self.assertEqual(tree["meshes"][1], original)

    def test_cable_shared_with_non_cable_or_unnamed_node_is_retained(self):
        for node in ({"name": "CONTROL", "mesh": 0}, {"mesh": 0}):
            tree = fixture()
            tree["nodes"].append(node)
            clean_export_tree(tree)
            self.assertEqual(tree["meshes"][0]["name"], "geometry_1234")

    def test_missing_name_or_unreferenced_mesh_cannot_lose_its_name(self):
        for modification in ("unreferenced", "unnamed"):
            tree = fixture()
            if modification == "unreferenced":
                del tree["nodes"][1]["mesh"]
            else:
                del tree["nodes"][1]["name"]
            clean_export_tree(tree)
            self.assertIn("name", tree["meshes"][1])

    def test_name_equality_alone_is_not_enough_without_matching_asset_metadata(self):
        for extras in ({}, {"asset_id": "F2-OTHER"}, {"asset_id": ""}, None, [], "metadata"):
            tree = fixture()
            tree["meshes"][1]["extras"] = extras
            clean_export_tree(tree)
            self.assertIn("name", tree["meshes"][1])
            if extras != {}:
                self.assertEqual(tree["meshes"][1]["extras"], extras)

    def test_cable_prefix_and_generated_name_matches_are_exact(self):
        for name in ("CABLE::STEP4A::00001", "CABLE::STEP4A::00001::0::label", "NOT-CABLE::STEP4A::1::0"):
            tree = fixture()
            tree["nodes"][0]["name"] = name
            clean_export_tree(tree)
            self.assertIn("name", tree["meshes"][0])
        for name in ("geometry_label", "geometry_1234_custom", "Cable model"):
            tree = fixture()
            tree["meshes"][0]["name"] = name
            clean_export_tree(tree)
            self.assertEqual(tree["meshes"][0]["name"], name)

    def test_manufacturer_metadata_protects_even_a_duplicate_name(self):
        flags = ({"model_id": "exact-model"}, {"exterior_only": True},
                 {"installation_status": "proposed_manufacturer_exterior"})
        for flag in flags:
            tree = fixture()
            tree["meshes"][1]["extras"].update(flag)
            before = copy.deepcopy(tree["meshes"][1])
            clean_export_tree(tree)
            self.assertEqual(tree["meshes"][1], before)

    def test_multimaterial_or_extension_mesh_name_is_not_removed(self):
        for variant in ("multiple_primitives", "extension"):
            tree = fixture()
            if variant == "multiple_primitives":
                tree["meshes"][1]["primitives"].append(copy.deepcopy(tree["meshes"][1]["primitives"][0]))
            else:
                tree["meshes"][1]["extensions"] = {"CUSTOM_names": {"name": "keep"}}
            before = copy.deepcopy(tree["meshes"][1])
            clean_export_tree(tree)
            self.assertEqual(tree["meshes"][1], before)

    def test_binary_padding_and_unknown_chunks_are_byte_identical(self):
        raw = encode(fixture(), b"\xff\x00\xff\x00" * 7, [(b"TEST", b"a\x00bc")])
        cleaned, _ = clean_glb_bytes(raw)
        self.assertEqual(read_glb(raw)[1][1:], read_glb(cleaned)[1][1:])

    def test_invalid_glb_framing_is_rejected(self):
        raw = encode(fixture())
        invalid = [raw[:10], raw[:-1], b"BAD!" + raw[4:],
                   raw[:4] + struct.pack("<I", 1) + raw[8:],
                   raw[:16] + b"BIN\x00" + raw[20:]]
        for data in invalid:
            with self.assertRaises(ValueError):
                read_glb(data)

    def test_equivalence_rejects_changes_to_every_protected_record_class(self):
        raw = encode(fixture())
        cleaned, _ = clean_glb_bytes(raw)
        clean, _ = read_glb(cleaned)
        mutations = [
            lambda t: t["nodes"][0].update(name="CHANGED"),
            lambda t: t["nodes"][0]["translation"].__setitem__(0, 99),
            lambda t: t["accessors"][0]["min"].__setitem__(0, 99),
            lambda t: t["accessors"][0].pop("byteOffset"),
            lambda t: t["meshes"][0]["primitives"][0].update(indices=99),
            lambda t: t["meshes"][1]["extras"]["nested"]["keep"].append(99),
            lambda t: t["meshes"][2].pop("name"),
            lambda t: t["meshes"][2]["extras"].pop("model_id"),
            lambda t: t["materials"][0].pop("name"),
            lambda t: t["bufferViews"][0].update(byteOffset=4),
            lambda t: t["scenes"][0]["nodes"].reverse(),
            lambda t: t["meshes"].reverse(),
        ]
        for index, mutate in enumerate(mutations):
            tree = copy.deepcopy(clean)
            mutate(tree)
            with self.subTest(mutation=index), self.assertRaises(ValueError):
                verify_export_equivalence(raw, encode(tree))
        with self.assertRaisesRegex(ValueError, "BIN"):
            verify_export_equivalence(raw, encode(clean, b"oops"))

    def test_same_trimesh_export_callback_matches_byte_cleanup(self):
        import numpy as np
        import trimesh
        scene = trimesh.Scene()
        for node, geometry, metadata in (
            ("CABLE::STEP4A::00001::0", "geometry_1", {}),
            ("F1-MON-01::PART::BEZEL", "F1-MON-01::PART::BEZEL", {"asset_id": "F1-MON-01"}),
            ("F4-USER-WS-01", "manufacturer::example::CHASSIS", {"model_id": "example"}),
        ):
            mesh = trimesh.creation.box()
            mesh.metadata = metadata
            scene.add_geometry(mesh, geom_name=geometry, node_name=node,
                               transform=trimesh.transformations.translation_matrix([1.25, 2.5, 3.75]))
        raw = scene.export(file_type="glb")
        cleaned, _ = clean_glb_bytes(raw)
        callback_export = scene.export(file_type="glb", tree_postprocessor=clean_export_tree)
        self.assertEqual(cleaned, callback_export)
        before_scene = trimesh.load(io.BytesIO(raw), file_type="glb", force="scene")
        after_scene = trimesh.load(io.BytesIO(cleaned), file_type="glb", force="scene")
        self.assertEqual(set(before_scene.graph.nodes_geometry), set(after_scene.graph.nodes_geometry))
        for node in before_scene.graph.nodes_geometry:
            a_transform, a_key = before_scene.graph[node]
            b_transform, b_key = after_scene.graph[node]
            np.testing.assert_array_equal(a_transform, b_transform)
            a, b = before_scene.geometry[a_key], after_scene.geometry[b_key]
            np.testing.assert_array_equal(a.vertices, b.vertices)
            np.testing.assert_array_equal(a.faces, b.faces)
            self.assertEqual(a.metadata, b.metadata)

    def test_current_full_fabric_meets_budget_without_losing_semantics(self):
        path = Path(__file__).with_name("generated") / "equity-uprise-electronics-fabric-v1.glb"
        raw = path.read_bytes()
        cleaned, proof = clean_glb_bytes(raw)
        self.assertLess(len(cleaned), 12_500_000)
        self.assertGreater(proof["base64_headroom_below_16_mib_bytes"], 200_000)
        self.assertEqual(proof["preserved_manufacturer_mesh_count"], 69)
        self.assertGreater(proof["preserved_node_count"], 20_000)
        a, _ = read_glb(raw)
        b, _ = read_glb(cleaned)
        self.assertEqual(a["nodes"], b["nodes"])
        self.assertEqual(a["accessors"], b["accessors"])
        for before, after in zip(a["meshes"], b["meshes"]):
            self.assertEqual(before["primitives"], after["primitives"])
            if before.get("extras"):
                self.assertEqual(before["extras"], after["extras"])

    def test_generated_proof_is_for_the_exact_current_export(self):
        folder = Path(__file__).with_name("generated")
        blob = (folder / "equity-uprise-electronics-fabric-v1.glb").read_bytes()
        report = json.loads((folder / "glb-export-equivalence-v2.json").read_text())
        current = verify_export_equivalence(blob, blob)
        self.assertTrue(report["passed"])
        self.assertEqual(report["after_bytes"], len(blob))
        self.assertEqual(report["after_sha256"], hashlib.sha256(blob).hexdigest())
        self.assertEqual(report["before_bytes"] - report["after_bytes"], report["saved_bytes"])
        self.assertGreater(report["removed_optional_fields"]["generated_cable_mesh_names"], 19000)
        self.assertGreater(report["removed_optional_fields"]["mesh_names_duplicating_sole_asset_node"], 3000)
        for key in ("binary_chunk_sha256", "nodes_sha256", "non_mesh_json_sha256",
                    "manufacturer_mesh_records_sha256", "cleaned_json_sha256",
                    "preserved_manufacturer_mesh_count", "preserved_node_count", "preserved_mesh_count",
                    "base64_payload_bytes", "base64_headroom_below_16_mib_bytes"):
            self.assertEqual(report[key], current[key], key)


if __name__ == "__main__":
    unittest.main()
