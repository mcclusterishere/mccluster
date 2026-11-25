import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPosition } from '../../js/game-hub/floating-capsule.mjs';
for (const [width,height] of [[320,568],[390,844],[844,390],[1024,768]]) {
  test(`capsule stays in viewport and reserves answers at ${width}x${height}`,()=>{
    const bounds={width,height,panelWidth:Math.min(340,width-16),panelHeight:58};
    for(const point of [null,{}, {x:NaN,y:Infinity},{x:-800,y:-900},{x:10000,y:10000}]) {
      const p=clampPosition(point,bounds);
      assert.ok(p.x>=8&&p.x+bounds.panelWidth<=width-8);
      assert.ok(p.y>=64&&p.y+58+8+96+88<=height);
    }
  });
}
