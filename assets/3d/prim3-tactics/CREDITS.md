# PRIM3 tactics: environment assets

All files here come from [Poly Haven](https://polyhaven.com) and are **CC0** (public domain). No attribution is required; it is recorded so the source is never in doubt.

| File(s) | Poly Haven asset | Use |
|---|---|---|
| `hdri/courtyard_night_1k.hdr` | [Courtyard Night](https://polyhaven.com/a/courtyard_night) (Greg Zaal), 1K HDR, unmodified | Image-based lighting, reflections and the blurred backdrop |
| `pbr/concrete_pavement_*` | [Concrete Pavement](https://polyhaven.com/a/concrete_pavement) | Board tiles |
| `pbr/cobblestone_square_*` | [Cobblestone Square](https://polyhaven.com/a/cobblestone_square) | Plaza around the board |
| `pbr/red_brick_03_*` | [Red Brick 03](https://polyhaven.com/a/red_brick_03) | Facade and wall pillars |
| `pbr/concrete_wall_006_*` | [Concrete Wall 006](https://polyhaven.com/a/concrete_wall_006) | Barriers, caps, sills, planters |

**Texture maps:** `_diff` is the colour (sRGB), `_nor_gl` the OpenGL normal map and `_rough` the roughness map. They were downscaled from the 1K originals to 512 px JPEG so a phone loads them quickly. `js/prim3-tactics/board3d.mjs` loads them after first paint; until then, or if they fail, procedural textures stand in.
