#!/usr/bin/env node
/* PRIM3 city levels — build level JSON from a committed extract (the batch step OVH Core would run).

     node tools/prim3-city/build-level.mjs [area-id] [--out file.json]

   Prints the level's stats; with --out, writes the level JSON (W, H, FLOORS, FRAME, SCENE, MISSION,
   engineConfig, attribution). Deterministic: the same extract always gives the same bytes. The output
   is ODbL (a derivative database of OpenStreetMap); keep its attribution and licence fields. */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCityLevel, levelToJSON } from './city-grid.mjs';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--out') + 1]) || 'jersey-city-paulus-hook';
const extract = JSON.parse(readFileSync(new URL(`./data/${id}.osm-extract.json`, import.meta.url), 'utf8'));
const level = buildCityLevel(extract);
const json = JSON.stringify(levelToJSON(level));
console.log(JSON.stringify({ level: level.LEVEL_ID, W: level.W, H: level.H, FLOORS: level.FLOORS, bytes: json.length, ...level.stats }, null, 2));
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
if (out) writeFileSync(out, json + '\n');
