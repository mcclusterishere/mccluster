"""Pure geometry regressions; the full GLB audit runs in building CI."""
import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).with_name('audit_device_placement.py')
spec = importlib.util.spec_from_file_location('device_placement', PATH)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def rectangle(x1, y1, x2, y2, z):
    return [('top', [[x1, y1, z], [x2, y1, z], [x2, y2, z]]),
            ('top', [[x1, y1, z], [x2, y2, z], [x1, y2, z]])]


class DevicePlacementTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
