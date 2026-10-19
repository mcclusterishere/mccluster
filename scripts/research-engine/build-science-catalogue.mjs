#!/usr/bin/env node
/* Offline physics-first music library indexing.
 * Derives descriptors from PUBLIC catalogue audio only, never gated masters,
 * creator-private uploads, a user's genome, or listening preferences.
 *
 * node scripts/research-engine/build-science-catalogue.mjs --dry-run
 * node scripts/research-engine/build-science-catalogue.mjs --max=12 --output=/tmp/resonance-index.json
 *
 * A reviewed storage/analytics schema is required before deploying as a service.
 */
import { readFile, writeFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { analyzePaths } from "../music-resonance-analyze.mjs";
import { scientificTrackIndex } from "../../js/resonance/associations.mjs";

const ROOT=resolve(fileURLToPath(new URL("../../",import.meta.url)));
const AUDIO=/^assets\/audio\/[a-z0-9_/-]+\.(?:wav|mp3|m4a|flac|ogg)$/i;
const VERSION="mcc.research.catalogue-index.v1";

export function eligibleTrack(album,track) {
  return album && typeof album.slug==="string" && track &&
    typeof track.title==="string" && !track.gated &&
    typeof track.src==="string" && AUDIO.test(track.src) &&
    !track.src.includes("..") && !track.src.includes("//");
}

export async function planCatalogue(catalogue) {
  const eligible=[],excluded=[];
  for(const album of Array.isArray(catalogue.albums)?catalogue.albums:[]) {
    for(const track of Array.isArray(album.tracks)?album.tracks:[]) {
      const id=String(album.slug||"")+"|"+String(track.title||"");
      if(!eligibleTrack(album,track)){
        excluded.push({id,reason:"not approved as a public same-origin audio source"});continue;
      }
      const full=resolve(ROOT,track.src);
      if(!full.startsWith(ROOT+sep)){excluded.push({id,reason:"invalid path"});continue;}
      let file;
      try {
        file=await realpath(full);
        if(!file.startsWith(ROOT+sep)||!(await stat(file)).isFile())
          throw Error("not a regular safe file");
      }catch {excluded.push({id,reason:"audio missing from checkout"});continue;}
      eligible.push({id,album:album.slug,title:track.title,src:track.src,file});
    }
  }
  return {eligible,excluded};
}

export async function buildIndex({maxTracks=12,dryRun=false}={}) {
  if(!Number.isInteger(maxTracks)||maxTracks<1||maxTracks>300)
    throw Error("--max must be an integer between 1 and 300");
  const source=await readFile(join(ROOT,"data/albums.json"),"utf8");
  const plan=await planCatalogue(JSON.parse(source));
  const result={
    schema:VERSION,scope:"approved public repository catalogue only",
    caveat:"No genre, mood, DNA activation, medical, or neural-personality inference",
    rightsBoundary:"No gated or private masters are decoded",
    definition:"Resonance classifications require a stated physical model and numerical features",
    catalogueSha256:createHash("sha256").update(source).digest("hex"),
    inspected:plan.eligible.length,
    skipped:[...plan.excluded],tracks:[]
  };
  if(dryRun){
    result.eligible=plan.eligible.slice(0,maxTracks).map(({file,...x})=>x);
    result.status="plan_only";return result;
  }
  for(const item of plan.eligible.slice(0,maxTracks)){
    try{
      const analysis=analyzePaths([item.file]);
      result.tracks.push({
        id:item.id,album:item.album,title:item.title,
        input:item.src,method:analysis.model,
        acoustic:analysis.features,dominantModes:analysis.dominantModes,
        tempo:analysis.musicTheory.tempo,key:analysis.musicTheory.key,
        scientific:scientificTrackIndex(analysis,analysis.musicTheory)
      });
    }catch(error){
      // Unavailable decoders or malformed media must not invent measurements.
      result.skipped.push({id:item.id,reason:"decoder or analysis unavailable: "+String(error.message).slice(0,180)});
    }
  }
  result.status=result.tracks.length?"provisional_features":"no_analyses";
  result.analyzed=result.tracks.length;
  return result;
}

if(/build-science-catalogue\.mjs$/.test(process.argv[1]||"")){
  try{
    let dryRun=false,output=null,maxTracks=12;
    for(const arg of process.argv.slice(2)){
      if(arg==="--dry-run")dryRun=true;
      else if(arg.startsWith("--max="))maxTracks=Number(arg.slice(6));
      else if(arg.startsWith("--output="))output=arg.slice(9);
      else throw Error("Unknown option: "+arg);
    }
    const result=JSON.stringify(await buildIndex({maxTracks,dryRun}),null,2)+"\n";
    if(output)await writeFile(output,result,{flag:"wx",mode:0o600});
    else process.stdout.write(result);
  }catch(error){process.stderr.write("[science-catalogue] "+error.message+"\n");process.exitCode=1;}
}
