# tools/

## `carve_l1_l2_void.py`

Cuts the central void into L1 and L2 and drops the forbidden PRIME roof
spur. Read its docstring — it explains where the hole's dimensions come
from, and every number in it was measured off the model rather than
chosen.

```
python3 assets/3d/prim3-site0/tools/carve_l1_l2_void.py \
    --in  assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v03.glb \
    --out assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v04.glb
```

It verifies its own output before exiting: L1 and L2 carved, the six other
plates still solid, no forbidden geometry. Re-running on its own output is
a no-op.

## The chunked master, retired 2026-08-19

`materialize_master_v03_chunks.py` and `master_v03_payload/*.b64` used to
rebuild the v03 GLB from seven base64 chunks. **They were broken and are
gone.**

The tool pinned one hash:

```
EXPECTED_SHA256 = "d471ef5b88ad79bfbad33a02d16970f47675202d68fce2e1085281d6a1849f66"
EXPECTED_BYTES  = 84880
```

Later commits — *"Replace Site 0 master payload chunk 00..06 with pristine
P1 master"* — replaced the chunks without updating that hash. The result
did not merely fail its own check: the concatenated payload was no longer
a valid gzip stream at all.

```
$ python3 materialize_master_v03_chunks.py
gzip.BadGzipFile: CRC check failed
```

Decoding by hand and streaming past the checksum failed too
(`Error -3 while decompressing data: incorrect data check`), so the chunks
were a mix of two generations and unrecoverable. **The canonical master
could not be produced from this repository by any means.**

The master was recovered from git history instead — it was committed as a
real blob before the chunking, and never deleted from history, only from
the tree.

`.github/workflows/site0-master-materialize.yml` went with them. It ran the
deleted script and rebuilt v03, which `v04` has superseded, so a manual
dispatch would have failed on the first step. A workflow that cannot succeed
is worse than no workflow: it invites someone to click it and read the
failure as a problem with the model.

The GLB is now committed **directly**. It is 95 KB. Splitting a 95 KB
binary into seven base64 chunks behind a hash-checked assembler bought
nothing and cost the asset entirely; git stores binaries perfectly well.
