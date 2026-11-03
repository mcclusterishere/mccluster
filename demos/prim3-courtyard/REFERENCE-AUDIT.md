# PRIM3 art-reference audit and implementation direction

## Current owner direction

Build the styled 3D tactical game with **featureless matte-black, human-proportioned mannequins**. Differentiate people through uniforms, equipment, faction identity, character labels and controlled country badges. Preserve recognizable silhouettes and animated movement. Do not introduce natural faces, hair, exposed human skin or accidental likenesses from older concepts.

The owner explicitly requested this treatment for in-game people. Earlier wardrobe documents established mannequins as the reference presentation; this current direction extends that appearance to the game itself. The country-badge request also supersedes older blanket exclusions on flags for this controlled badge treatment. Use documented country assignments and keep the badges subordinate to role recognition.

## Verified repository references

Source repository: [mcclusterishere/Prim3](https://github.com/mcclusterishere/Prim3). Audited main commit: **`160020bdeac4afa0cd3f25638169e657af55bc29`**. No upstream assets were modified by this recovery.

Main contains **five distinct selected reference sheets in six raster files**. Four sheets show black mannequins; one shows a fully helmeted Prime. The executive JPEG and WebP depict the same design. The black and bone corporate sheets are colorways of one capsule, so these sheets cover four outfit/role families.

| Selected sheet and exact repository source | Meaning and use |
|---|---|
| [CFI-01 Authority Black](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/assets/canon/brands/mccluster-corp/corporate-fits-identity/MCC-CFI-01-authority-black-v01.jpg) | Faceless black mannequin in Company Wear. Daily institutional wardrobe and off-kit cohort; 1536 × 1024 JPEG. |
| [CFI-02 Bone Herringbone](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/assets/canon/brands/mccluster-corp/corporate-fits-identity/MCC-CFI-02-bone-herringbone-v01.jpg) | Same mannequin, garment lineup and cuts in bone. A colorway, not another character class; 1536 × 1024 JPEG. |
| [SOI-01 Security Officer](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/assets/canon/brands/mccluster-corp/security-officer-identity/MCC-SOI-01-authority-black-v01.jpg) | Facility guard: corporate clothing, thin vest, body camera, cyberdeck and one holstered sidearm; 1536 × 1024 JPEG. |
| [EI-01 Executive Authority](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/assets/canon/brands/mccluster-corp/executive-identity/MCC-EI-01-modern-executive-horizontal-two-stripe-clip-v01.webp) | Black mannequin, single-breasted black suit, ivory shirt, plain black tie, two horizontal red stripes forming the clip and oxblood shoes; 4096 × 2731 WebP. |
| [Post-succession Prime suit](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/assets/canon/characters/prime-negative-one/PRIME-N1-character-sheet.png) | Approved enclosed M helmet, segmented armor and rear Mission Core; 1536 × 1024 PNG, 2,276,829 bytes. Preserve this special suit instead of distributing it to ordinary operatives. |

Each containing directory has a controlling `README.md`. The corporate and security boards establish canonical visual direction with candidate garment/equipment specifications. The executive has canonical visual direction; the Prime sheet is explicitly `APPROVED-REFERENCE`.

**Use the executive WebP.** Its sibling `MCC-EI-01-modern-executive-horizontal-two-stripe-clip-v01.jpg` fails strict decoding with a broken-data-stream error. The README selects the complete WebP. Do not mistake that redundant JPEG for a sixth design.

## Field roles and the opposing side

The [canonical phenotype identities](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/story/PHENOTYPE-IDENTITIES.md) distinguish people, roles and clothes:

| Label | PRIM role and primary identity | Hitman counterpart and primary identity |
|---|---|---|
| E | Entry/access/protection — Arjun Mehta | Social/Entry — Rae “Twin” Colton |
| R | Recon/overwatch — Rafael Costa | Overwatch — Chris “Perch” Alvarez |
| T | Technical objective — Aya Shinoda | Deniable Tech — Jules “Kiosk” Mendez |

Use [FIELD-KITS.md](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/phenotypes/operators/FIELD-KITS.md): E has the strongest protective silhouette and entry equipment; R is lightest with optics/sensors; T has cyberdeck/interfaces and freedom for device work. The individual `FO-E.md`, `FO-R.md` and `FO-T.md` appearance documents remain proposed. The phenotype index records no dedicated approved field-triad skin. Recovered operator concepts help construct those appearances without pretending every pictured accessory is standard issue.

Hitman is a functional counterpart with its own street/corporate identity. Its [brand authority](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/story/HITMAN-BRAND.md) specifies ivory HM, a central chrome AMMC cartridge and a thin halo. Do not put PRIM Dual Sight marks on Hitman assets or merely recolor PRIM uniforms.

## Recovered original work

`PRIM3-original-reference-pack.zip` preserves **19 unchanged original PNGs** and three provenance/handoff documents. All originals fully decode at 1536 × 1024. Their file and decoded-pixel hashes are distinct. These are **19 saved iterations, not 19 finished characters**: 18 mannequin boards and one human-model exception.

The exception is `McCluster private-client black tailoring board.png`, which shows a natural face, hair, skin and sunglasses. Keep it as historical wardrobe evidence; do not copy its person into this game.

Four originals match selected compositions: Quiet Luxury → CFI-01; Bone Herringbone → CFI-02; Corporate Operator Kit → SOI-01; Twin Red Tie Clip → EI-01. These are source-stage composition matches, not byte-identical canonical replacements. Nine executive iterations conflict with the final standard through double-breasted cuts, patterned ties, upright slashes or visible carrier bars. The manifest identifies them individually.

Archive SHA-256: `339c0793ec8aec31b7c5c8fc2868725a7f0a6ec2bd8d528996c6793963c7d719`.

## Countries, marks and actual 3D production

The [immediate cast authority](https://github.com/mcclusterishere/Prim3/blob/160020bdeac4afa0cd3f25638169e657af55bc29/story/IMMEDIATE-CAST-CANON.md) lists **24 nationally mapped mains**, not every country: United States, Japan, India, China, Indonesia, Pakistan, Nigeria, Brazil, Bangladesh, Russia, Ukraine, Ethiopia, Mexico, Egypt, Philippines, Democratic Republic of the Congo, Vietnam, Iran, Turkey, Germany, Thailand, United Kingdom, France and South Africa. Three public/system/apex presences and twelve Hitman figures bring the immediate architecture to **39 recurring slots**. The older 24+48 matrix is a development/history pool, not 72 active canonical nationals. Do not invent Hitman nationalities from names.

Use the [locked SVG mark masters](https://github.com/mcclusterishere/Prim3/tree/160020bdeac4afa0cd3f25638169e657af55bc29/assets/canon/brands/mccluster-corp/marks) directly. Do not redraw, trace or regenerate identity from raster boards.

Finally, **PNG/JPEG/WebP references are not GLB models**. They supply material, silhouette and equipment direction. The actual game requires mannequin meshes, wardrobe and equipment geometry, materials, skeletons, skin weights and compatible animation clips. Preserve those distinctions while implementing reusable animated 3D people and site integration; an image or reference archive alone is not the finished game.
