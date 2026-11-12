"""Pure geometry regressions; the full GLB audit runs in building CI."""
import importlib.util
import unittest
import tempfile
import json
import copy
import struct
from pathlib import Path

PATH = Path(__file__).with_name('audit_device_placement.py')
spec = importlib.util.spec_from_file_location('device_placement', PATH)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def rectangle(x1, y1, x2, y2, z):
    return [('top', [[x1, y1, z], [x2, y1, z], [x2, y2, z]]),
            ('top', [[x1, y1, z], [x2, y2, z], [x1, y2, z]])]


class DevicePlacementTest(unittest.TestCase):
    def test_strict_acceptance_requires_exact_geometry_and_bindings(self):
        self.assertFalse(audit.acceptance_passed([], [], []))
        self.assertFalse(audit.acceptance_passed([], [], [{"passed": False}]))
        self.assertFalse(audit.acceptance_passed(["unsupported"], [], [{"passed": True}]))
        self.assertFalse(audit.acceptance_passed([], ["intersection"], [{"passed": True}]))
        self.assertTrue(audit.acceptance_passed([], [], [{"passed": True}]))

    def test_supported_monitor(self):
        self.assertEqual(audit.support_contact([[1, 1, 2.5], [2, 2, 3.2]], rectangle(0, 0, 3, 3, 2.5))['status'], 'contact')

    def test_eleven_inch_floating_monitor(self):
        result = audit.support_contact([[1, 1, 3.33], [2, 2, 3.98]], rectangle(0, 0, 3, 3, 29 / 12))
        self.assertEqual(result['status'], 'no_contact')
        self.assertAlmostEqual(result['samples'][0]['gap_ft'] * 12, 10.96, places=3)

    def test_table_bounding_box_is_not_a_surface(self):
        triangle = [[0, 0, 2.5], [3, 0, 2.5], [0, 3, 2.5]]
        self.assertIsNone(audit.surface_height(triangle, 2, 2))

    def test_partial_overhang_is_not_fully_supported(self):
        result = audit.support_contact([[1, 1, 2.5], [2, 2, 3.2]], rectangle(0, 0, 1.5, 3, 2.5))
        self.assertEqual(result['status'], 'partial_contact')

    def test_wall_is_not_support(self):
        self.assertIsNone(audit.surface_height([[1, 0, 0], [1, 3, 0], [1, 3, 3]], 1, 1))

    def test_downward_underside_is_not_support(self):
        self.assertIsNone(audit.surface_height([[0, 0, 2.5], [0, 3, 2.5], [3, 0, 2.5]], 1, 1))

    def test_penetration_is_not_contact(self):
        self.assertEqual(audit.support_contact([[1, 1, 2.3], [2, 2, 3.2]], rectangle(0, 0, 3, 3, 2.5))['status'], 'no_contact')

    def test_coordinate_frame_adds_floor_height_once(self):
        ffe = 67.5
        result = audit.support_contact([[1, 1, ffe + 2.5], [2, 2, ffe + 3.2]], rectangle(0, 0, 3, 3, ffe + 2.5))
        self.assertEqual(result['status'], 'contact')

    def test_current_dual_panel_spacing_intersects(self):
        self.assertEqual(audit.intersection([[-.86, -.06, 0], [.86, .06, .98]], [[-.16, -.06, 0], [1.56, .06, .98]]), [1.02, .12, .98])

    def test_adjacent_or_separated_panels_do_not_intersect(self):
        a = [[0, 0, 0], [1, .2, 1]]
        self.assertIsNone(audit.intersection(a, [[1, 0, 0], [2, .2, 1]]))
        self.assertIsNone(audit.intersection(a, [[1.1, 0, 0], [2.1, .2, 1]]))


class AuthoredBindingTest(unittest.TestCase):
    def setUp(self):
        self.bindings = audit.load_bindings()
        self.binding = copy.deepcopy(next(iter(self.bindings.values())))

    def write_and_load(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bindings.json'
            path.write_text(json.dumps({'schema_version': '1.0.0', 'bindings': rows}))
            return audit.load_bindings(path)

    def test_all_explicit_bindings(self):
        self.assertEqual(len(self.bindings), 98)
        self.assertEqual(sum(x['level'] == 1 for x in self.bindings.values()), 8)
        self.assertEqual(sum(bool(x.get('model_id')) for x in self.bindings.values()), 36)

    def test_no_duplicate_id_fallback(self):
        with self.assertRaises(ValueError):
            self.write_and_load([self.binding, self.binding])

    def test_unknown_support_does_not_borrow_neighbor(self):
        surfaces = rectangle(0, 0, 3, 3, 2.5)
        declared = [(name, tri) for name, tri in surfaces if name == 'missing']
        self.assertEqual(audit.support_contact([[1, 1, 2.5], [2, 2, 3]], declared)['status'], 'no_contact')

    def test_malformed_coordinates_fail_closed(self):
        for value in ([float('nan'), 1], [73, 1], [1], [True, 1]):
            self.binding['origin_xy_ft'] = value
            with self.assertRaises(ValueError):
                self.write_and_load([self.binding])

    def test_noncardinal_yaw_rejected_by_axis_aligned_audit(self):
        self.binding['yaw_degrees'] = 30
        with self.assertRaises(ValueError):
            self.write_and_load([self.binding])

    def test_geometry_must_face_the_declared_direction(self):
        b = self.binding
        b.pop("model_id", None)
        p = audit.bound_position(b, 0)
        def point_bounds(center):
            return [[v - .02 for v in center], [v + .02 for v in center]]
        nodes = {b['asset_id']: point_bounds(p),
                 b['asset_id'] + '::PART::FRONT_IO': point_bounds([p[0] + .05, p[1] + .59, p[2] + .48])}
        self.assertTrue(audit.binding_geometry_matches(b, nodes, 0))
        b['yaw_degrees'] = 0
        self.assertFalse(audit.binding_geometry_matches(b, nodes, 0))

    def test_bound_height_adds_ffe_once(self):
        from device_placement_bindings import bound_position
        self.binding.pop('model_id', None)
        self.binding.update(asset_type='monitor', support_top_aff_ft=2.5)
        self.assertAlmostEqual(bound_position(self.binding, 67.5)[2], 70.92)


class GeneratedFabricExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = (audit.PROD / 'electronics/generated/equity-uprise-electronics-fabric-v1.glb').read_bytes()
        assert data[:4] == b'glTF'
        cls.scene = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])

    def test_cable_constructor_recipes_are_not_shipped(self):
        segments = [n for n in self.scene['nodes'] if n['name'].startswith('CABLE::STEP4A::')]
        self.assertGreater(len(segments), 0)
        for node in segments:
            extras = self.scene['meshes'][node['mesh']].get('extras', {})
            self.assertFalse(set(extras) & {'shape', 'height', 'radius', 'sections'})

    def test_all_declared_device_component_nodes_are_preserved(self):
        devices = json.loads((audit.PROD / 'electronics/generated/equity-uprise-device-components-v1.json').read_text())['devices']
        names = {n['name'] for n in self.scene['nodes']}
        for device in devices:
            for component in device['components']:
                self.assertIn(component['mesh_name'], names)


if __name__ == '__main__':
    unittest.main()
