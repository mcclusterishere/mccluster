#!/usr/bin/env python3
"""F4-F6 station clearances on real rebuilt GLBs, before overlay integration.

Manufacturer outer envelopes and conservative monitor envelopes prove space and
support, not final manufacturer mesh accuracy, ventilation, installation safety,
visual approval or live hardware. The ASUS envelope covers the published main
body only; unsized projecting handles/feet and installed total height remain
unverified. Run F4/F5/F6 builders before this test.
"""
import itertools
import json
import math
from pathlib import Path
import sys
import unittest

import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
PROD = HERE.parent
sys.path.insert(0, str(PROD / 'interiors'))
from audit_device_placement import read_geometry, support_contact, intersection
from device_placement_bindings import load_bindings

FT = .3048
MANIFEST = HERE / 'device-stations-f4-f6-v1.json'


def bounds_for(binding, dims, center):
    t = trimesh.transformations.rotation_matrix(math.radians(binding['yaw_degrees']), [0, 0, 1])
    t[:3, 3] = [*binding['origin_xy_ft'], binding['support_top_aff_ft']]
    m = trimesh.creation.box(extents=dims)
    m.apply_translation(center)
    m.apply_transform(t)
    return m.bounds


class UpperStations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MANIFEST.read_text())
        cls.bindings = load_bindings(MANIFEST)
        cls.layouts, cls.nodes, cls.surfaces, cls.parts = {}, {}, {}, {}
        for f in (4, 5, 6):
            cls.layouts[f] = json.loads((PROD / f'floor-{f:02}/floor-{f:02}-interior-layout-v3.json').read_text())
            path = PROD / f'generated/equity-uprise-floor-{f:02}-core-v2.glb'
            cls.nodes[f], cls.surfaces[f] = read_geometry(path, 1 / FT)
            scene = trimesh.load(path, force='scene')
            cls.parts[f] = []
            for name in scene.graph.nodes_geometry:
                t, key = scene.graph[name]
                m = scene.geometry[key].copy()
                m.apply_transform(t)
                m.apply_scale(1 / FT)
                cls.parts[f].extend((name, n, p.bounds) for n, p in enumerate(m.split(only_watertight=False)))
        cls.boxes, cls.bases = {}, {}
        for aid, b in cls.bindings.items():
            if b['asset_type'] == 'workstation':
                e = cls.data['manufacturer_envelopes_m'][f"F{b['level']}"]
                w, d, h = (e[k] / FT for k in ('width', 'depth', 'height'))
                cls.bases[aid] = cls.boxes[aid] = bounds_for(b, (w, d, h), (0, 0, h / 2))
            else:
                # Existing monitor stand center is +.08Y relative to its origin.
                cls.bases[aid] = bounds_for(b, (.72, .48, .06), (0, .08, .03))
                cls.boxes[aid] = bounds_for(b, (1.82, .48, 1.6525), (0, .08, 1.6525 / 2))

    def test_all_existing_identities_and_named_staff_remain(self):
        expected = set()
        for f, count in ((4, 8), (5, 8), (6, 6)):
            expected.update(f'F{f}-USER-WS-{n:02}' for n in range(1, count + 1))
            expected.update(f'F{f}-USER-MON-{n:02}-{m:02}' for n in range(1, count + 1) for m in (1, 2))
        self.assertEqual(set(self.bindings), expected)
        for f, staff in {4: {'Priya Srisawat', 'Maren Quill'}, 5: {'Oksana Bondarenko', 'Leila Hosseini', 'Amira Hassan'}, 6: {'Helen Clarke', 'Li Wei', 'Marc Dubois'}}.items():
            self.assertEqual({i['occupant'] for i in self.layouts[f]['items'] if i.get('occupant')}, staff)
        self.assertEqual(self.bindings['F6-USER-WS-01']['station_id'], 'F6-OFFICE-HELEN-CLARKE-DESK')

    def test_every_base_has_five_contacts_on_exact_declared_mesh(self):
        for aid, b in self.bindings.items():
            with self.subTest(asset=aid):
                triangles = [(n, t) for n, t in self.surfaces[b['level']] if n == b['support_node']]
                self.assertTrue(triangles, b['support_node'])
                self.assertEqual(support_contact(self.bases[aid], triangles)['contact_samples'], 5)
                if b['support_node'] == 'floor_slab':
                    self.assertEqual(b['asset_type'], 'workstation')
                    self.assertEqual(b['support_top_aff_ft'], 0)

    def test_device_envelopes_clear_actual_furniture_and_architecture_parts(self):
        for aid, b in self.bindings.items():
            for node, part, other in self.parts[b['level']]:
                self.assertIsNone(intersection(self.boxes[aid], other), (aid, node, part))
        for a, b in itertools.combinations(self.bindings, 2):
            if self.bindings[a]['level'] == self.bindings[b]['level']:
                self.assertIsNone(intersection(self.boxes[a], self.boxes[b]), (a, b))

    def test_all_dual_bezels_have_positive_gap_and_face_the_chair(self):
        for station in self.data['stations']:
            f = station['level']
            items = {i['id']: i for i in self.layouts[f]['items']}
            chair = items[station['chair_id']]
            a, b = [self.bindings[aid] for aid in station['monitor_asset_ids']]
            gap = np.linalg.norm(np.subtract(a['origin_xy_ft'], b['origin_xy_ft'])) - 1.82
            self.assertAlmostEqual(gap, .18)
            for binding in (a, b):
                angle = math.radians(binding['yaw_degrees'])
                front = np.array([math.sin(angle), -math.cos(angle)])
                direction = np.array([chair['x'], chair['y']]) - binding['origin_xy_ft']
                self.assertGreater(float(np.dot(front, direction / np.linalg.norm(direction))), .92)

    def test_keyboard_parts_remain_aligned_to_the_station(self):
        for station in self.data['stations']:
            f = station['level']
            item = next(i for i in self.layouts[f]['items'] if i['id'] == station['station_id'])
            self.assertTrue(item['size']['keyboard'])
            if item['type'] != 'carrel':
                self.assertEqual(item['size']['monitors'], 0)
            h = 2.5 if item['type'] == 'desk_exec_l' else 29 / 12
            x, y = (.3, -.35) if item['type'] == 'desk_exec_l' else (0, .45 if item['type'] == 'carrel' else item['size'].get('keyboard_y_ft', .15))
            t = trimesh.transformations.rotation_matrix(math.radians(item['rot_deg']), [0, 0, 1])
            t[:3, 3] = [item['x'], item['y'], 0]
            keyboard = trimesh.creation.box(extents=(1.5, .5, .04))
            keyboard.apply_translation((x, y, h + .02)); keyboard.apply_transform(t)
            self.assertTrue(any(n == station['keyboard_node'] and np.allclose(b, keyboard.bounds, atol=1e-5) for n, _, b in self.parts[f]), station['station_id'])

    def test_exact_scenic_supersessions_and_unrelated_surfaces(self):
        for record in self.data['scenic_screen_supersessions']:
            for name in record.get('removed_nodes', []):
                self.assertNotIn(name, self.nodes[record['level']])
            self.assertTrue(all(a in self.bindings for a in record['replacement_asset_ids']))
        for f, ids in {4: ['F4-DISPLAY-LISTEN', 'F4-DISPLAY-WATCH', 'F4-DISPLAY-ARCHIVE', 'F4-SET-MONITOR-01'], 5: ['F5-DISPLAY-RESEARCH', 'F5-DISPLAY-EVIDENCE', 'F5-DISPLAY-RECORD', 'F5-ARCHIVE-SEARCH-01', 'F5-SOURCE-DISPLAY-01', 'F5-PUB-DISPLAY-01'], 6: ['F6-DISPLAY-NOW', 'F6-DISPLAY-PAST', 'F6-DISPLAY-JOIN', 'F6-HALO-GLOBE-01', 'F6-STRATEGY-DISPLAY-01', 'F6-BRIEFING-DISPLAY-01']}.items():
            for aid in ids:
                self.assertTrue(any(n.startswith(aid + '::') for n in self.nodes[f]), aid)
        report = json.loads((PROD / 'generated/equity-uprise-floor-04-core-v2-report.json').read_text())
        self.assertEqual(report['inventory_records_modeled'], 66)
        self.assertEqual(len(report['inventory_records_replaced']), 2)

    def test_research_carrels_and_meeting_tables_remain_useful(self):
        items = {i['id']: i for i in self.layouts[5]['items']}
        for n in range(1, 6):
            self.assertEqual(items[f'F5-CARREL-{n:02}']['size']['w_in'], 54)
            self.assertFalse(items[f'F5-CARREL-{n:02}']['size']['paper'])
        self.assertTrue(items['F5-CARREL-06']['size']['paper'])
        for f, name in ((5, 'F5-POLICY-TABLE-01'), (6, 'F6-COMMAND-TABLE-01')):
            item = next(i for i in self.layouts[f]['items'] if i['id'] == name)
            self.assertEqual((item['x'], item['y'], item['size']['w_in'], item['size']['d_in']), (36, 41, 192, 60))
            self.assertFalse(any(b['station_id'] == name for b in self.bindings.values()))


if __name__ == '__main__':
    unittest.main(verbosity=2)
