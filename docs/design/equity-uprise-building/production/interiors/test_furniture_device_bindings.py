"""Scenic screens can be retired without deleting useful input furniture."""
import unittest
import numpy as np
from audit_interior_consistency import occupied_footprints, footprint_overlap, rot_pts, inside
from eu_furniture_kit import form_desk, form_desk_l, form_workbench, form_carrel


class Recorder:
    def __init__(self): self.boxes = []
    def cbox(self, *args): self.boxes.append(args)
    def cyl(self, *args): self.boxes.append(args)


def boxes(form, options):
    recorder = Recorder()
    form(recorder, 5.5, 2.5, 29 / 12, options)
    return recorder.boxes


class FurnitureDeviceBindingsTest(unittest.TestCase):
    def test_desk_keyboard_survives_scenic_monitor_removal(self):
        blank = boxes(form_desk, {'monitors': 0})
        bound = boxes(form_desk, {'monitors': 0, 'keyboard': True})
        self.assertEqual(len(bound), len(blank) + 1)
        self.assertIn((0, .15, 1.5, .5, 29 / 12, 29 / 12 + .04, 'metal'), bound)
        self.assertFalse(any(part[-1] == 'screen' for part in bound))

    def test_default_desk_keeps_original_keyboard(self):
        original = boxes(form_desk, {})
        no_keyboard = boxes(form_desk, {'keyboard': False})
        self.assertEqual(len(original), len(no_keyboard) + 1)
        self.assertEqual(sum(x[-1] == 'screen' for x in original), 1)

    def test_workbench_and_carrel_keyboard_are_opt_in(self):
        for form in (form_workbench, form_carrel):
            plain = boxes(form, {})
            bound = boxes(form, {"keyboard": True})
            self.assertEqual(len(bound), len(plain) + 1)
            self.assertIn((0, .45, 1.5, .5, 29 / 12, 29 / 12 + .04, "metal"), bound)

    def test_l_desk_retirement_is_explicit(self):
        original = boxes(form_desk_l, {})
        bound = boxes(form_desk_l, {'monitors': 0, 'keyboard': True})
        self.assertEqual(sum(x[-1] == 'screen' for x in original), 1)
        self.assertFalse(any(x[-1] == 'screen' for x in bound))
        self.assertEqual(len(bound), len(original) - 2)


class LDeskFootprintTest(unittest.TestCase):
    def test_empty_knee_space_is_not_occupied(self):
        parts = occupied_footprints({'x': 0, 'y': 0}, {'form': 'desk_l'}, 6, 5.5)
        self.assertEqual(footprint_overlap(parts, [rot_pts(1, 1.5, 1, 1, 0)]), 0)
        self.assertGreater(footprint_overlap(parts, [rot_pts(-2, 1.5, 1, 1, 0)]), .9)
        self.assertGreater(footprint_overlap(parts, [rot_pts(1, -1, 1, 1, 0)]), .9)

    def test_rotation_and_custom_depth_follow_real_desk(self):
        item = {'x': 65.4, 'y': 8.6, 'rot_deg': 180, 'size': {'main_depth_in': 30, 'return_depth_in': 18}}
        parts = occupied_footprints(item, {'form': 'desk_l'}, 6, 5.5)
        self.assertFalse(any(inside(p, np.array([[64.4, 7.1]])).any() for p in parts))
        self.assertTrue(any(inside(p, np.array([[67.9, 7.1]])).any() for p in parts))


if __name__ == '__main__':
    unittest.main()
