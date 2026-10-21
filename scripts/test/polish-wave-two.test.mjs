import assert from "node:assert/strict";import fs from "node:fs";
const css=fs.readFileSync("css/ops-polish.css","utf8");
for(const p of ["inbox.html","crm.html","desk.html","management.html"]){const h=fs.readFileSync(p,"utf8");assert.match(h,/css\/ops-polish\.css/);assert.match(h,/data-ops-polish="wave-2"/);}
assert.match(css,/--ops-ease:var\(--mcc-ease/);assert.match(css,/mcc-rise/);assert.match(css,/mcc-badge-in/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/:focus/);
console.log("Wave 2 operating-room polish contract OK");