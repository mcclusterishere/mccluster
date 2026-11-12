"""Authored furniture bindings for staged repairs; no inferred station fallback."""
import json
import math
from pathlib import Path

PATH = Path(__file__).with_name('device-placement-bindings-v1.json')
# Bottom of the existing componentized archetype relative to its origin, in feet.
# These are generic training models, not manufacturer dimensional specifications.
BASE_OFFSETS = {'workstation': .81, 'monitor': .92}
CATALOG_PATH = PATH.with_name('manufacturer-model-references-v1.json')

def model_reference(model_id):
    models = json.loads(CATALOG_PATH.read_text())['models']
    for entry in models:
        if entry['model_id'] == model_id:
            return entry
    raise ValueError(f'Unknown manufacturer model: {model_id}')

def origin_height(binding):
    # Registry positions remain envelope centers. Manufacturer meshes themselves
    # are bottom-origin and are translated down by this value exactly once.
    if binding.get('model_id'):
        return model_reference(binding['model_id'])['dimensions_m']['height'] / .3048 / 2
    return BASE_OFFSETS[binding['asset_type']]


def load_bindings(path=PATH):
    data = json.loads(Path(path).read_text())
    if data.get('schema_version') != '1.0.0':
        raise ValueError('Unsupported placement binding schema')
    rows = list(data['bindings'])
    for source in data.get('binding_sources', []):
        if Path(source).name != source:
            raise ValueError('Binding source must be an explicit sibling file')
        fragment = json.loads(Path(path).with_name(source).read_text())
        if fragment.get('schema_version') != '1.0.0':
            raise ValueError(f'Unsupported binding fragment: {source}')
        rows.extend(fragment['bindings'])
    result = {}
    for row in rows:
        binding = dict(row)
        if binding['asset_type'] == 'workstation':
            model_id = data.get('model_ids_by_level', {}).get(str(binding['level']))
            if model_id:
                model_reference(model_id)
                binding['model_id'] = model_id
        if binding.get('model_id'):
            if binding['asset_type'] != 'workstation':
                raise ValueError('Manufacturer chassis binding must be a workstation')
            model_reference(binding['model_id'])
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
        exact_slab = binding['support_node'] == 'floor_slab' and kind == 'workstation'
        if (not binding['support_node'].startswith(tag + '-') and not exact_slab) or not binding['station_id'].startswith(tag + '-'):
            raise ValueError(f'Binding requires exact same-floor support and station IDs: {aid}')
        result[aid] = binding
    return result


def bound_position(binding, floor_elevation_ft):
    """Keep support AFF separate from world FFE; apply FFE exactly once."""
    return [*binding['origin_xy_ft'], floor_elevation_ft + binding['support_top_aff_ft'] + origin_height(binding)]
