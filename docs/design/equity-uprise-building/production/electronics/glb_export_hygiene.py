"""Lossless optional-field cleanup for the electronics GLB, not mesh compression.

Only empty mesh extras, generated cable geometry names, and a nonmanufacturer
mesh name exactly duplicated by its sole named node may be omitted. All populated
extras and manufacturer mesh names remain. Consumers resolve canonical node IDs;
mesh-array indexes and every primitive, accessor, material and BIN byte stay put.

CLI compares raw and cleaned versions of the *same* export, never two rebuilds:
  python glb_export_hygiene.py --input raw.glb --output cleaned.glb --report proof.json
The generator uses clean_export_tree as a trimesh tree_postprocessor.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import struct

_CABLE_NODE = re.compile(r"CABLE::STEP4A::[0-9]+::[0-9]+\Z")
_GENERATED_NAME = re.compile(r"geometry_[0-9]+\Z")
_JSON = b"JSON"
_BIN = b"BIN\x00"


def _references(tree):
    result = defaultdict(list)
    for node in tree.get("nodes", []):
        index = node.get("mesh")
        if type(index) is int:
            result[index].append(node)
    return result


def _manufacturer_mesh(mesh):
    extra = mesh.get("extras", {})
    return (str(mesh.get("name", "")).startswith("manufacturer::")
            or isinstance(extra, dict) and ("model_id" in extra
                or extra.get("exterior_only") is True
                or extra.get("installation_status") == "proposed_manufacturer_exterior"))


def _name_removal_reason(mesh, references):
    name = mesh.get("name")
    # A multi-primitive mesh creates child names in common glTF loaders. Unknown
    # extension naming contracts, unreferenced meshes and manufacturer identities
    # are deliberately excluded rather than guessed to be redundant.
    if (not isinstance(name, str) or not references or _manufacturer_mesh(mesh)
            or "extensions" in mesh or len(mesh.get("primitives", [])) != 1):
        return None
    if (_GENERATED_NAME.fullmatch(name)
            and all(_CABLE_NODE.fullmatch(str(n.get("name", ""))) for n in references)):
        return "generated_cable_mesh_names"
    if len(references) == 1 and references[0].get("name") == name:
        extras = mesh.get("extras", {})
        asset = extras.get("asset_id") if isinstance(extras, dict) else None
        if isinstance(asset, str) and asset and (name == asset or name.startswith(asset + "::PART::")):
            return "mesh_names_duplicating_sole_asset_node"
    return None


def clean_export_tree(tree):
    """Mutate only the explicit optional-field allowlist, deterministically.

    The return value is a compact audit count; trimesh ignores it. Do not turn
    this into recursive metadata stripping or remove accessor default fields.
    """
    stats = {"empty_mesh_extras": 0, "generated_cable_mesh_names": 0,
             "mesh_names_duplicating_sole_asset_node": 0}
    references = _references(tree)
    for index, mesh in enumerate(tree.get("meshes", [])):
        reason = _name_removal_reason(mesh, references[index])
        if reason:
            del mesh["name"]
            stats[reason] += 1
        if mesh.get("extras") == {}:
            del mesh["extras"]
            stats["empty_mesh_extras"] += 1
    return stats


def read_glb(data):
    """Read strict GLB framing without decoding, rewriting or dropping BIN data."""
    if len(data) < 20:
        raise ValueError("Truncated GLB header")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Invalid GLB header, version or declared length")
    chunks = []
    offset = 12
    while offset < length:
        if length - offset < 8:
            raise ValueError("Truncated GLB chunk header")
        size, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        if size % 4 or offset + size > length:
            raise ValueError("Invalid GLB chunk alignment or length")
        chunks.append((kind, bytes(data[offset:offset + size])))
        offset += size
    if not chunks or chunks[0][0] != _JSON or sum(k == _JSON for k, _ in chunks) != 1:
        raise ValueError("GLB must have exactly one leading JSON chunk")
    tree = json.loads(chunks[0][1])
    if not isinstance(tree, dict):
        raise ValueError("GLB JSON must be an object")
    return tree, chunks


def _json_bytes(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("utf-8")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _encode_glb(tree, chunks):
    content = _json_bytes(tree)
    # Match trimesh's deterministic exporter, including its full padding word
    # when JSON is already aligned. Other chunks are retained byte-for-byte.
    content += b" " * (4 - ((len(content) + 20) % 4))
    body = struct.pack("<I4s", len(content), _JSON) + content
    for kind, payload in chunks[1:]:
        body += struct.pack("<I4s", len(payload), kind) + payload
    return struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body


def verify_export_equivalence(before, after):
    """Fail if anything outside the narrowly allowed optional fields changed."""
    raw, raw_chunks = read_glb(before)
    clean, clean_chunks = read_glb(after)
    if raw_chunks[1:] != clean_chunks[1:]:
        raise ValueError("BIN or another non-JSON chunk changed")
    if {k: v for k, v in raw.items() if k != "meshes"} != {
            k: v for k, v in clean.items() if k != "meshes"}:
        raise ValueError("A non-mesh field changed: nodes, transforms, accessors, materials and buffers must stay exact")
    raw_meshes, clean_meshes = raw.get("meshes", []), clean.get("meshes", [])
    if len(raw_meshes) != len(clean_meshes):
        raise ValueError("Mesh array length changed")
    references = _references(raw)
    removed = {"empty_mesh_extras": 0, "generated_cable_mesh_names": 0,
               "mesh_names_duplicating_sole_asset_node": 0}
    for index, (original, result) in enumerate(zip(raw_meshes, clean_meshes)):
        allowed = original.copy()
        reason = _name_removal_reason(original, references[index])
        if reason and "name" not in result:
            del allowed["name"]
            removed[reason] += 1
        if original.get("extras") == {} and "extras" not in result:
            del allowed["extras"]
            removed["empty_mesh_extras"] += 1
        if allowed != result:
            raise ValueError(f"Unapproved mesh change at index {index}")
    manufacturers = [m for m in raw_meshes if _manufacturer_mesh(m)]
    binary = [payload for kind, payload in raw_chunks if kind == _BIN]
    return {
        "schema_version": "1.0.0",
        "status": "verified_same_export_equivalence_not_visual_approval",
        "passed": True,
        "before_bytes": len(before), "after_bytes": len(after),
        "saved_bytes": len(before) - len(after),
        "before_sha256": _sha(before), "after_sha256": _sha(after),
        "removed_optional_fields": removed,
        "preserved_mesh_count": len(raw_meshes),
        "preserved_node_count": len(raw.get("nodes", [])),
        "preserved_manufacturer_mesh_count": len(manufacturers),
        "manufacturer_mesh_records_sha256": _sha(_json_bytes(manufacturers)),
        "nodes_sha256": _sha(_json_bytes(raw.get("nodes", []))),
        "binary_chunk_sha256": [_sha(payload) for payload in binary],
        "non_mesh_json_sha256": _sha(_json_bytes({k: v for k, v in raw.items() if k != "meshes"})),
        "cleaned_json_sha256": _sha(_json_bytes(clean)),
        "preserved": "Every node name and transform, mesh index and primitive, populated mesh extra, manufacturer name/metadata, accessor, buffer view, material, scene and all non-JSON chunk bytes. No geometry or numeric value is simplified.",
        "size_budget_bytes": 12_500_000,
        "size_budget_passed": len(after) < 12_500_000,
        "base64_payload_bytes": 4 * ((len(after) + 2) // 3),
        "base64_headroom_below_16_mib_bytes": 16 * 1024 * 1024 - 4 * ((len(after) + 2) // 3),
    }


def clean_glb_bytes(before):
    """Clean an existing export, preserve its complete binary chunks, and prove it."""
    tree, chunks = read_glb(before)
    clean_export_tree(tree)
    after = _encode_glb(tree, chunks)
    return after, verify_export_equivalence(before, after)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if len({p.resolve() for p in (args.input, args.output, args.report)}) != 3:
        parser.error("Input, output and report must be distinct files")
    after, report = clean_glb_bytes(args.input.read_bytes())
    args.output.write_bytes(after)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Verified: {report['before_bytes']:,} -> {report['after_bytes']:,} bytes; BIN and semantic records unchanged")


if __name__ == "__main__":
    main()
