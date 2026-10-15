#!/usr/bin/env node
// Generate a reviewable ADM1 boundary import manifest; never guess region IDs.
import {writeFile,mkdir} from 'node:fs/promises';
const iso3=(process.argv[2]||'USA').toUpperCase();
if(!/^[A-Z]{3}$/.test(iso3))throw Error('Provide ISO-3 country code, e.g. USA');
const endpoint='https://www.geoboundaries.org/api/current/gbOpen/'+iso3+'/ADM1/';
const response=await fetch(endpoint);if(!response.ok)throw Error('geoBoundaries metadata '+response.status);
const metadata=await response.json();
const geoUrl=metadata.simplifiedGeometryGeoJSON||metadata.gjDownloadURL;
if(!geoUrl||!geoUrl.startsWith('https://'))throw Error('No trusted HTTPS GeoJSON');
const geometryResponse=await fetch(geoUrl);if(!geometryResponse.ok)throw Error('Geometry '+geometryResponse.status);
const geo=await geometryResponse.json();
if(geo.type!=='FeatureCollection'||!Array.isArray(geo.features))throw Error('Invalid FeatureCollection');
const features=geo.features.map((feature,index)=>({
 index,source_id:feature.properties?.shapeID||null,
 name:feature.properties?.shapeName||null,
 source_iso:feature.properties?.shapeISO||null,
 geometry_type:feature.geometry?.type,
 geometry:feature.geometry,
 region_key:null,
 status:'requires_iso3166_2_mapping_and_geometry_review'
}));
const output={source:'geoBoundaries gbOpen ADM1',source_url:endpoint,geometry_url:geoUrl,
 boundary_id:metadata.boundaryID,license:metadata.boundaryLicense,
 source_version:metadata.buildDate,attribution:'geoBoundaries, William & Mary — '+endpoint,
 warning:'REVIEW ONLY. Verify license, source_iso and canonical region_key before database insertion. Never infer ISO 3166-2 from names alone.',
 features};
await mkdir('tmp/adm1-review',{recursive:true});
const dest='tmp/adm1-review/'+iso3+'.json';
await writeFile(dest,JSON.stringify(output,null,2)+'\n');
console.log('Review manifest:',dest,'regions:',features.length);
