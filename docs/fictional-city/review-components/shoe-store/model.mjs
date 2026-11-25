/* Native procedural model assembly for the city's existing createGeometryKit.
   Caller owns group/material disposal, camera, movement and UI. No new renderer. */
import { storeFloor } from './layout.mjs';

const C = Object.freeze({ ink: '#263839', bone: '#e9dfc9', brass: '#b99b61', stone: '#b8b5a9', wall: '#596966', mint: '#8cafa4', red: '#a35843', steel: '#566260', black: '#303735', light: '#f0e5be' });

export function buildStoreFloorModel(layout, floorId, { batch, detail = 'near' }) {
  const f = storeFloor(layout, floorId), factory = f.id === 'factory';
  const add = (shape, color, x, y, z, w, h, d, rotation = null, basic = false) => batch.add(shape, color, x, y, z, w, h, d, rotation, null, { basic });
  const box = (color, x, y, z, w, h, d) => add('box', color, x, y, z, w, h, d);
  const near = detail === 'near';
  box(factory ? C.stone : C.bone, 0, -.12, 0, f.width, .24, f.depth);
  box(factory ? C.wall : C.ink, 0, 1.9, -7, 18, 3.8, .18);
  // Low side/front cutaways keep a readable arrival and accessible camera sightline.
  for (const side of [-1, 1]) box(factory ? C.wall : C.bone, side * 9, 1.15, 0, .18, 2.3, 14);
  for (const side of [-1, 1]) box(C.ink, side * 5.5, .28, 7, 7, .56, .18);
  for (let x = -8; x <= 8; x += 2) box(factory ? '#a5a79e' : '#d4c9b3', x, .008, 0, .025, .012, 14);
  if (!factory) {
    // Perimeter light strips and brass reveals. No marks or reconstructed branding.
    for (const side of [-1, 1]) {
      add('box', C.light, side * 8.83, 2.35, 0, .055, .055, 13.7, null, true);
      box(C.brass, side * 8.82, .16, 0, .04, .2, 13.7);
    }
    box('#b7a98d', 0, .015, 4.1, 10.7, .02, 3.8);
  } else {
    // Shared service pipes are decorative, not walkable geometry or live controls.
    for (const z of [-6.3, -5.9]) add('cylinder', C.red, 0, 3.1, z, .12, 17, .12, [0, 0, Math.PI / 2]);
    for (const x of [-6, 0, 6]) box(C.light, x, 3.2, -6.75, 3.5, .12, .12);
    for (const x of [-4.3, 5.7]) box(C.brass, x, .015, .2, .08, .02, 12.4);
  }
  function table(p, color = C.steel) {
    box(color, p.x, p.h, p.z, p.w, .12, p.d);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(C.steel, p.x + dx * (p.w / 2 - .14), p.h / 2, p.z + dz * (p.d / 2 - .14), .11, p.h, .11);
  }
  function sampleShoe(x, y, z, color = C.mint, scale = 1) {
    box(C.black, x, y + .055 * scale, z, .4 * scale, .11 * scale, .78 * scale);
    box(color, x, y + .21 * scale, z - .02 * scale, .36 * scale, .28 * scale, .67 * scale);
    box(color, x, y + .4 * scale, z - .23 * scale, .33 * scale, .3 * scale, .25 * scale);
    if (near) for (let i = 0; i < 3; i++) box(C.bone, x, y + .36 * scale, z + i * .08 * scale, .26 * scale, .025 * scale, .025 * scale);
  }
  for (const p of f.fixtures) {
    if (p.type === 'display') {
      // Open display case facing the central aisle; do not bury mounts in a solid box.
      box(C.ink, p.x + Math.sign(p.x) * (p.w / 2 - .06), 1.05, p.z, .12, 2.1, p.d);
      box(C.ink, p.x, .2, p.z, p.w, .4, p.d);
      for (const end of [-1, 1]) box(C.ink, p.x, 1.2, p.z + end * (p.d / 2 - .04), p.w, 1.9, .08);
      box(C.brass, p.x, 2.15, p.z, p.w + .03, .07, p.d + .03);
      for (const z of [-.5, .5]) {
        box(C.bone, p.x, 1.2, p.z + z, p.w - .12, .08, .8);
        // Empty collection mounts. Pending slots never render a made-up release.
        box(C.brass, p.x, 1.32, p.z + z, .6, .08, .5);
        if (near) box(C.light, p.x, 1.66, p.z + z - .37, .9, .025, .025);
      }
    } else if (p.type === 'hero') {
      box(C.ink, p.x, p.h / 2, p.z, p.w, p.h, p.d);
      box(C.brass, p.x, p.h + .04, p.z, p.w + .03, .08, p.d + .03);
      // Three original fit samples, separate from collection slots and canon props.
      for (const [i, color] of [C.mint, C.bone, C.red].entries()) sampleShoe(p.x + (i - 1) * .65, p.h + .09, p.z, color, .85);
    } else if (p.type === 'bench') {
      box(C.ink, p.x, .28, p.z, p.w - .2, .5, p.d - .15);
      box(C.mint, p.x, .61, p.z, p.w, .22, p.d);
      box(C.mint, p.x, .88, p.z - .45, p.w, .45, .3);
    } else if (p.type === 'checkout') {
      box(C.ink, p.x, p.h / 2, p.z, p.w, p.h, p.d);
      box(C.bone, p.x, p.h + .06, p.z, p.w + .08, .12, p.d + .08);
      box(C.brass, p.x, .65, p.z + p.d / 2 + .02, p.w - .12, .06, .03);
      box(C.black, p.x + 1.3, p.h + .34, p.z, .65, .42, .12);
    } else if (p.type === 'partition') {
      // Intentional cutaway uses same solid floor footprint, not a hidden doorway.
      box(C.wall, p.x, .65, p.z, p.w, 1.3, p.d);
      box(C.brass, p.x, 1.33, p.z, p.w, .06, p.d + .04);
    } else if (p.type === 'stock' || p.type === 'textiles') {
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(C.steel, p.x + dx * p.w * .45, p.h / 2, p.z + dz * p.d * .45, .09, p.h, .09);
      for (const y of [.4, 1.2, 2.0]) {
        box(C.steel, p.x, y, p.z, p.w, .08, p.d);
        for (const dz of near ? [-.55, .55] : [0]) {
          if (p.type === 'textiles') add('cylinder', dz < 0 ? C.mint : C.bone, p.x, y + .3, p.z + dz, .5, p.w * .8, .5, [0, 0, Math.PI / 2]);
          else box(C.brass, p.x, y + .25, p.z + dz, p.w * .7, .45, .75);
        }
      }
    } else if (p.type === 'press') {
      box(C.steel, p.x, .65, p.z, p.w, 1.3, p.d);
      for (const side of [-1, 1]) box(C.black, p.x + side * .63, 1.5, p.z - .3, .15, 1.2, .18);
      box(C.red, p.x, 2.05, p.z - .3, 1.5, .25, .8);
      add('cylinder', C.brass, p.x, 1.65, p.z - .3, .15, .7, .15);
      box(C.bone, p.x, 1.35, p.z + .15, .65, .08, .7);
    } else if (p.type === 'garments') {
      for (const dx of [-1, 1]) box(C.steel, p.x + dx * (p.w / 2 - .1), 1, p.z, .08, 2, .08);
      box(C.steel, p.x, 2, p.z, p.w, .08, .08);
      for (const dx of near ? [-.8, -.4, 0, .4, .8] : [-.65, .65]) {
        box(C.mint, p.x + dx, 1.35, p.z, .18, .95, .7);
        box(C.mint, p.x + dx, 1.7, p.z, .18, .3, 1.0);
      }
    } else {
      table(p, p.type === 'cutting' ? C.bone : C.steel);
      if (p.type === 'conveyor') {
        box(C.black, p.x, p.h + .1, p.z, p.w - .1, .15, p.d - .1);
        for (let x = -1.8; x < 2; x += near ? .3 : .6) box(C.stone, p.x + x, p.h + .19, p.z, .04, .025, p.d - .2);
        if (near) for (const dx of [-1.2, 0, 1.2]) sampleShoe(p.x + dx, p.h + .2, p.z, C.bone, .75);
      } else if (p.type === 'sewing') {
        for (const dx of [-.8, .8]) {
          box(C.bone, p.x + dx, p.h + .1, p.z, 1.0, .12, .7);
          box(C.mint, p.x + dx + .25, p.h + .35, p.z, .2, .5, .4);
          box(C.mint, p.x + dx, p.h + .55, p.z, .7, .17, .4);
          if (near) box(C.steel, p.x + dx - .23, p.h + .34, p.z, .025, .27, .025);
        }
      } else if (p.type === 'cutting') box(C.mint, p.x - .45, p.h + .08, p.z, 2.0, .06, 1.2);
      else if (p.type === 'finishing') sampleShoe(p.x, p.h + .07, p.z, C.red);
      else box(C.brass, p.x, p.h + .25, p.z, 1.3, .45, .8);
    }
  }
  // A visible stair hatch/landing remains clear for the floor-transition adapter.
  box(C.ink, 6.3, .02, -5.2, 2.0, .035, 2.0);
  for (let i = 0; i < 5; i++) box(C.brass, 6.3, .045, -5.85 + i * .32, 1.7, .035, .06);
  return { floorId: f.id, layout: f, modelId: layout.id, detail, transition: 'explicit-floor-link-required' };
}
