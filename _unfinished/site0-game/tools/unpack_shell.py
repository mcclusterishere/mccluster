#!/usr/bin/env python3
"""Put the perfect exterior shell in place for `game/index.html?shell=1`.

WHY THIS EXISTS INSTEAD OF A COMMITTED FILE
-------------------------------------------
The fitted shell is 46,981,872 bytes. The repo already carries its source at
the root as `PRIM3+site+zero+perfect+model.zip` (22 MB, tracked), so committing
the unpacked-and-fitted GLB would put a second, larger copy of the same mesh in
history forever for an asset the game loads only when you ask it to.

So the repo keeps two small things instead:

    game/assets/site0_shell_fit.json   the fit -- a translation and a scale
    tools/unpack_shell.py              this, which applies it

Run it once and `?shell=1` works. Delete the output whenever you like; nothing
else depends on it.

    python3 tools/unpack_shell.py

The fit itself is computed by `tools/fit_shell_to_interior.py`, which measured
it against the interior and verified containment. This script only replays the
recorded numbers, and re-verifies the source is the file they were measured
from before it does.
"""
from __future__ import annotations

import hashlib
import json
import struct
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "game" / "assets"
REPO = HERE.parents[2]
ZIP = REPO / "PRIM3+site+zero+perfect+model.zip"
MEMBER = "PRIM3+site+zero+perfect+model.glb"
ZIP_SHA1 = "f77645703af1dfb30b06446ba9112c3fc701a5d4"
OUT = ASSETS / "site0_shell_fitted.glb"
FIT = ASSETS / "site0_shell_fit.json"


def read_glb(data: bytes):
    magic, ver, _ = struct.unpack("<III", data[:12])
    if magic != 0x46546C67 or ver != 2:
        raise SystemExit("not a glTF 2.0 GLB")
    js, binc, off = None, b"", 12
    while off < len(data):
        (clen,) = struct.unpack("<I", data[off : off + 4])
        tag, body = data[off + 4 : off + 8], data[off + 8 : off + 8 + clen]
        if tag[:4] == b"JSON":
            js = json.loads(body)
        elif tag[:3] == b"BIN":
            binc = body
        off += 8 + clen
    return js, bytearray(binc)


def write_glb(path: Path, js: dict, binc: bytearray) -> None:
    while len(binc) % 4:
        binc.append(0)
    jb = json.dumps(js, separators=(",", ":")).encode()
    while len(jb) % 4:
        jb += b" "
    total = 12 + 8 + len(jb) + (8 + len(binc) if binc else 0)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    if binc:
        out += struct.pack("<II", len(binc), 0x004E4942) + bytes(binc)
    path.write_bytes(out)


def main() -> None:
    if not ZIP.exists():
        raise SystemExit(f"source not found: {ZIP}")
    got = hashlib.sha1(ZIP.read_bytes()).hexdigest()
    if got != ZIP_SHA1:
        raise SystemExit(
            f"{ZIP.name} is not the file the fit was measured against\n"
            f"  expected sha1 {ZIP_SHA1}\n  got      sha1 {got}\n"
            f"Re-run tools/fit_shell_to_interior.py against the new source."
        )
    if not FIT.exists():
        raise SystemExit(f"fit manifest missing: {FIT}")
    fit = json.loads(FIT.read_text())["transform"]

    with zipfile.ZipFile(ZIP) as z:
        raw = z.read(MEMBER)
    js, binc = read_glb(raw)

    node = js["nodes"][0]
    node["translation"] = fit["translation"]
    node["scale"] = fit["scale"]
    node["name"] = "SHELL_EXTERIOR_PERFECT"
    js["meshes"][node["mesh"]]["name"] = "SHELL_EXTERIOR_PERFECT"
    js.setdefault("asset", {}).setdefault("extras", {})["fit"] = fit

    ASSETS.mkdir(parents=True, exist_ok=True)
    write_glb(OUT, js, binc)
    print(f"wrote {OUT.relative_to(REPO)} ({OUT.stat().st_size:,} bytes)")
    print(f"  translation {fit['translation']}  scale {fit['scale']}")
    print("  open game/index.html?shell=1")


if __name__ == "__main__":
    main()
