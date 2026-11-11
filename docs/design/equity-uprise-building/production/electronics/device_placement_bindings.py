"""Authored furniture bindings for staged repairs; no inferred station fallback."""
import json
import math
from pathlib import Path

PATH = Path(__file__).with_name('device-placement-bindings-v1.json')
# Bottom of the existing componentized archetype relative to its origin, in feet.
# These are generic training models, not manufacturer dimensional specifications.
BASE_OFFSETS = {'workstation': .81, 'monitor': .92}


def load_bindings(path=PATH):
    data = json.loads(Path(path).read_text())
    if data.get('schema_version') != '1.0.0':
        raise ValueError('Unsupported placement binding schema')
    result = {}
    for binding in data['bindings']:
        aid = binding['asset_id']
        if aid in result:
            raise ValueError(f'Duplicate placement binding: {aid}')
        kind = binding['asset_type']
        level = binding['level']
        tag = 'B1' if level == 0 else 'L7' if level == 7 else f'F{level}'
        if kind not in BASE_OFFSETS or type(level) is not int or not 0 <= level <= 7 or not aid.startswith(tag + '-USER-'):
            raise ValueError(f'Invalid binding identity: {aid}')
        xy = binding['origin_xy_ft']
        if len(xy) != 2 or not all(type(x) in (int, float) and math.isfinite(x) and 0 <= x <= 72 for x in xy):
            raise ValueError(f'Invalid XY: {aid}')
        height = binding['support_top_aff_ft']
        if type(height) not in (int, float) or not math.isfinite(height) or not 0 <= height <= 5:
            raise ValueError(f'Invalid support height: {aid}')
        if binding['yaw_degrees'] not in (0, 90, 180, 270):
            raise ValueError(f'Unsupported non-cardinal orientation: {aid}')
        if not binding['support_node'].startswith(tag + '-') or not binding['station_id'].startswith(tag + '-'):
            raise ValueError(f'Binding requires exact same-floor support and station IDs: {aid}')
        result[aid] = binding
    return result


def bound_position(binding, floor_elevation_ft):
    """Keep support AFF separate from world FFE; apply FFE exactly once."""
    return [*binding['origin_xy_ft'], floor_elevation_ft + binding['support_top_aff_ft'] + BASE_OFFSETS[binding['asset_type']]]
