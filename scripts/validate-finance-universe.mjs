/* Offline schema/provenance checks. No fetch, publication or private account import. */
import {readFile} from 'node:fs/promises';
import {validateUniverseReference,validateSectorPilot,universeSummary} from '../workers/mccluster/src/finance/universe.js';
const root=new URL('../',import.meta.url);
const directory=validateUniverseReference(JSON.parse(await readFile(new URL('data/markets/sec-listing-directory.json',root),'utf8')));
const pilot=validateSectorPilot(JSON.parse(await readFile(new URL('data/markets/sector-research-pilot.json',root),'utf8')),directory);
console.log(JSON.stringify({directory:directory.counts,pilot:pilot.coverage,eligibility:'unknown',ownership:'not_asserted',source_sha256:universeSummary().source.sha256},null,2));
