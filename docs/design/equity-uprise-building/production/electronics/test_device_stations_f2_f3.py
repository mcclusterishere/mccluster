#!/usr/bin/env python3
"""F2/F3 station repair checks against freshly built, real floor meshes.

Run the F2/F3 builders first, then this file with Python + numpy + trimesh.
The generic and manufacturer envelopes below test available desk space. They
are not replacement device meshes, manufacturer mounting instructions, visual
approval, structural certification or evidence of live hardware. The integrated
electronics GLB remains subject to audit_device_placement.py.
"""
from pathlib import Path
import json
import math
import sys
import unittest

import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
PROD = HERE.parent
sys.path.insert(0, str(PROD / 'interiors'))
from audit_device_placement import read_geometry, support_contact, intersection
from device_placement_bindings import load_bindings

MANIFEST = HERE / 'device-stations-f2-f3-v1.json'
FT = .3048
H = 29 / 12
EXPECTED_STATIONS = {
    'F2-USER-WS-01': ('F2-DESK-CHIOMA-OKEKE', 'Chioma Okeke'),
    'F2-USER-WS-02': ('F2-DESK-SARI-WULANDARI', 'Sari Wulandari'),
    'F3-USER-WS-01': ('F3-DESK-NUSRAT-RAHMAN', 'Nusrat Rahman'),
    'F3-USER-WS-02': ('F3-DESK-ARJUN-MEHTA', 'Arjun Mehta'),
    'F3-USER-WS-03': ('F3-DESK-RAFAEL-COSTA', 'Rafael Costa'),
    'F3-USER-WS-04': ('F3-DESK-MCCLUSTER-FELLOWSHIP', 'McCluster'),
}
# Established legacy component geometry in build_equity_uprise_electronics_v1.py.
# These stay separate from the source-backed manufacturer's outer envelope.
GENERIC = {
    'workstation': ((.76, 1.12, 1.62), (0, 0, .81)),
    'monitor_base': ((.72, .48, .06), (0, .08, .03)),
    # Conservative outer box includes the real bezel, panel, stem and base.
    'monitor_envelope': ((1.82, .48, 1.6525), (0, .08, 1.6525 / 2)),
}


def transform(binding):
    t = trimesh.transformations.rotation_matrix(math.radians(binding['yaw_degrees']), [0, 0, 1])
    t[:3, 3] = [*binding['origin_xy_ft'], binding['support_top_aff_ft']]
    return t


def bounds_for(binding, dims, center):
    mesh = trimesh.creation.box(extents=dims)
    mesh.apply_translation(center)
    mesh.apply_transform(transform(binding))
    return mesh.bounds


class Stations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MANIFEST.read_text())
        cls.bindings = load_bindings(MANIFEST)
        cls.layouts = {}
        cls.nodes = {}
        cls.surfaces = {}
        cls.pieces = {}
        cls.meshes = {}
        for level in (2, 3):
            path = PROD / f'generated/equity-uprise-floor-{level:02}-core-v2.glb'
            if not path.exists():
                raise RuntimeError(f'Run the Floor {level} builder before these tests: {path}')
            layout = json.loads((PROD / f'floor-{level:02}/floor-{level:02}-interior-layout-v3.json').read_text())
            cls.layouts[level] = layout
            cls.nodes[level], cls.surfaces[level] = read_geometry(path, scale=1 / FT)
            scene = trimesh.load(path, force='scene')
            cls.pieces[level] = []
            for name in scene.graph.nodes_geometry:
                t, key = scene.graph[name]
                mesh = scene.geometry[key].copy()
                mesh.apply_transform(t)
                mesh.apply_scale(1 / FT)
                cls.meshes[name] = mesh
                for number, part in enumerate(mesh.split(only_watertight=False)):
                    cls.pieces[level].append((name, number, part.bounds))

    def exact_support(self, binding, bounds):
        triangles = [(name, tri) for name, tri in self.surfaces[binding['level']]
                     if name == binding['support_node']]
        self.assertTrue(triangles, binding['support_node'])
        result = support_contact(bounds, triangles)
        self.assertEqual(result['contact_samples'], 5, (binding['asset_id'], result))
        return result

    def test_existing_identities_counts_and_staff_are_preserved(self):
        expected = set(EXPECTED_STATIONS)
        expected.update(aid.replace('-WS-', '-MON-') + '-01' for aid in EXPECTED_STATIONS)
        self.assertEqual(set(self.bindings), expected)
        for aid, (station, occupant) in EXPECTED_STATIONS.items():
            binding = self.bindings[aid]
            self.assertEqual(binding['station_id'], station)
            item = next(x for x in self.layouts[binding['level']]['items'] if x['id'] == station)
            self.assertEqual(item['occupant'], occupant)
            self.assertEqual(binding['support_node'], station + '::' + item['type'])
            self.assertEqual(binding['support_top_aff_ft'], H)
            self.assertEqual(item['size']['monitors'], 0)
            self.assertTrue(item['size']['keyboard'])

    def test_generic_bases_touch_exact_real_desk_triangles(self):
        for binding in self.bindings.values():
            with self.subTest(asset=binding['asset_id']):
                key = 'workstation' if binding['asset_type'] == 'workstation' else 'monitor_base'
                self.exact_support(binding, bounds_for(binding, *GENERIC[key]))

    def test_manufacturer_envelopes_fit_real_support(self):
        expected = {2: (.0968, .2261, .2055), 3: (.254, .440, .384)}
        for aid in EXPECTED_STATIONS:
            binding = self.bindings[aid]
            spec = binding['manufacturer_envelope']
            dims = spec['dimensions_m']
            self.assertEqual(tuple(dims[k] for k in ('width', 'height', 'depth')), expected[binding['level']])
            if binding['level'] == 3:
                self.assertEqual(spec['revision'], 'thelio-major-r5-n4')
            w, d, h = (dims[k] / FT for k in ('width', 'depth', 'height'))
            self.exact_support(binding, bounds_for(binding, (w, d, h), (0, 0, h / 2)))

    def test_screens_face_the_real_chairs(self):
        for binding in self.bindings.values():
            if binding['asset_type'] != 'monitor':
                continue
            chair = binding['station_id'] + '-CHAIR::task_chair'
            self.assertIn(chair, self.nodes[binding['level']])
            chair_center = np.mean(self.nodes[binding['level']][chair], axis=0)[:2]
            toward_chair = chair_center - np.array(binding['origin_xy_ft'])
            toward_chair /= np.linalg.norm(toward_chair)
            front = transform(binding)[:2, :2] @ np.array([0, -1])
            self.assertGreater(float(np.dot(front, toward_chair)), .999)

    def test_only_bound_scenic_monitors_are_superseded_and_keyboards_remain(self):
        for aid in EXPECTED_STATIONS:
            binding = self.bindings[aid]
            level = binding['level']
            node = binding['support_node']
            item = next(x for x in self.layouts[level]['items'] if x['id'] == binding['station_id'])
            mesh = self.meshes[node]
            # Desk recipe has no geometry above keyboard top once its scenic
            # monitor parts are suppressed. The merged furniture node is retained.
            self.assertAlmostEqual(mesh.bounds[1][2], H + .04, places=5)
            t = trimesh.transformations.rotation_matrix(math.radians(item['rot_deg']), [0, 0, 1])
            t[:3, 3] = [item['x'], item['y'], 0]
            keyboard = trimesh.creation.box(extents=(1.5, .5, .04))
            keyboard.apply_translation((0, .15, H + .02))
            keyboard.apply_transform(t)
            components = [b for n, _, b in self.pieces[level] if n == node]
            self.assertTrue(any(np.allclose(b, keyboard.bounds, atol=1e-5) for b in components), node)
        self.assertGreater(self.meshes['F2-DESK-THANDIWE-NKOSI::desk_dual'].bounds[1][2], H + 1)
        self.assertIn('F3-BENCH-AYA-SHINODA::workbench', self.meshes)
        for level, ids in {
            2: ['F2-DISPLAY-CURRENT-ISSUES', 'F2-DISPLAY-PERSPECTIVES', 'F2-DISPLAY-OPPORTUNITIES', 'F2-TALK-INTERFACE-01', 'F2-MEMBER-CHECKIN-01'],
            3: ['F3-DISPLAY-MATCH', 'F3-DISPLAY-PEOPLE', 'F3-DISPLAY-APPLICATIONS', 'F3-PEOPLE-DISPLAY-01', 'F3-INTERVIEW-A-DISPLAY-01', 'F3-INTERVIEW-B-DISPLAY-01', 'F3-MEMBER-CHECKIN-01'],
        }.items():
            for aid in ids:
                self.assertTrue(any(n.startswith(aid + '::') for n in self.nodes[level]), aid)

    def test_envelopes_do_not_intersect_furniture_or_each_other(self):
        for use_manufacturer in (False, True):
            boxes = {}
            for aid, binding in self.bindings.items():
                if binding['asset_type'] == 'monitor':
                    boxes[aid] = [bounds_for(binding, *GENERIC[k]) for k in ('monitor_base', 'monitor_envelope')]
                elif use_manufacturer:
                    dims = binding['manufacturer_envelope']['dimensions_m']
                    w, d, h = (dims[k] / FT for k in ('width', 'depth', 'height'))
                    boxes[aid] = [bounds_for(binding, (w, d, h), (0, 0, h / 2))]
                else:
                    boxes[aid] = [bounds_for(binding, *GENERIC['workstation'])]
            for aid, bounds in boxes.items():
                binding = self.bindings[aid]
                for box in bounds:
                    for node, part, other in self.pieces[binding['level']]:
                        self.assertIsNone(intersection(box, other, tolerance=1e-4), (use_manufacturer, aid, node, part))
                for other_id in boxes:
                    if other_id <= aid or self.bindings[other_id]['level'] != binding['level']:
                        continue
                    for box in bounds:
                        for other in boxes[other_id]:
                            self.assertIsNone(intersection(box, other), (use_manufacturer, aid, other_id))

    def test_devices_stay_in_staff_zone_outside_public_rooms_and_keep_clear(self):
        for aid, binding in self.bindings.items():
            layout = self.layouts[binding['level']]
            item = next(x for x in layout['items'] if x['id'] == binding['station_id'])
            self.assertEqual(item['zone'], 'cohort-desks' if binding['level'] == 2 else 'field-ops')
            for area in layout['keep_clear']:
                b = area['bounds_ft']
                x, y = binding['origin_xy_ft']
                self.assertFalse(b['x1'] <= x <= b['x2'] and b['y1'] <= y <= b['y2'], (aid, area['id']))
        f2 = next(x for x in self.layouts[2]['items'] if x['id'] == 'F2-FORUM-TABLE-01')
        f3 = next(x for x in self.layouts[3]['items'] if x['id'] == 'F3-OPPORTUNITY-TABLE-01')
        self.assertEqual((f2['x'], f2['y'], f2['size']['w_in']), (36, 39, 144))
        self.assertEqual((f3['x'], f3['y'], f3['size']['w_in'], f3['size']['d_in']), (36, 41, 192, 48))


if __name__ == '__main__':
    unittest.main(verbosity=2)
