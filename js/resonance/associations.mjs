/* Scientific indexing: audio observations -> educational research topics.
 * Region links are literature navigation. They are NOT user-specific brain
 * activation predictions, medical classifications or genetic inferences.
 */
const num = x => typeof x==="number" && Number.isFinite(x) ? x : null;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function scientificTrackIndex(resonance, theory) {
  const f=resonance?.features||{}, tempo=theory?.tempo||{}, key=theory?.key||{};
  const result=[];
  const bass=num(f.lowBandFraction), flat=num(f.spectralFlatness), centroid=num(f.centroidHz);
  const beat=num(tempo.bpm), beatConfidence=num(tempo.confidence);
  const keyConfidence=num(key.confidence);
  const first=resonance?.dominantModes?.[0];
  if(first && Number.isInteger(first.m) && Number.isInteger(first.n)){
    result.push({id:"mode",family:"modeled-resonance",value:"Membrane mode ("+first.m+","+first.n+")",
      evidence:"modeled",meaning:"Leading response for this stated resonator, not a song's universal shape"});
  }
  if(bass!=null)result.push({id:"bass",family:"spectral-distribution",
    value:bass>=.44?"Low-frequency enriched":bass<=.16?"Less low-frequency energy":"Mixed low-frequency energy",
    measurement:Number((bass*100).toFixed(1))+"%",evidence:"measured-audio",
    meaning:"Fraction of analyzed audio power between 20 and 250 Hz, within the sampled window"});
  if(flat!=null)result.push({id:"texture",family:"spectral-structure",
    value:flat>=.48?"Broadband texture":flat<.13?"Concentrated tonal components":"Mixed spectrum",
    measurement:Number(flat.toFixed(3)),evidence:"measured-audio",
    meaning:"Spectral flatness from analyzed windows, not a genre or state of mind"});
  if(centroid!=null)result.push({id:"brightness",family:"spectral-structure",
    value:centroid>=2200?"Higher spectral centroid":centroid<700?"Lower spectral centroid":"Midrange spectral centroid",
    measurement:Math.round(centroid)+" Hz",evidence:"measured-audio",
    meaning:"Spectral energy-weighted center for sampled audio, not physical brightness"});
  if(beat!=null && beatConfidence!=null && beatConfidence>=.13){
    result.push({id:"beat",family:"rhythmic-periodicity",value:"~"+Math.round(beat)+" BPM",
      measurement:Number(beatConfidence.toFixed(2)),evidence:"estimated-model",
      meaning:"Onset-periodicity hypothesis; half/double-time ambiguity and changing tempo remain possible"});
  }else result.push({id:"beat",family:"rhythmic-periodicity",value:"Unresolved",
    evidence:"insufficient-evidence",meaning:"No defensible single tempo could be established"});
  if(typeof key.name==="string" && key.name && keyConfidence!=null && keyConfidence>=.2){
    result.push({id:"tonality",family:"tonal-distribution",value:key.name,
      measurement:Number(keyConfidence.toFixed(2)),evidence:"estimated-model",
      meaning:"Chroma-profile estimate; not proof of a key or a unique neural target"});
  }else result.push({id:"tonality",family:"tonal-distribution",value:"Unresolved",
    evidence:"insufficient-evidence",meaning:"No defensible single global key from these audio samples"});
  return {schema:"mcc.research.scientific-track-index.v1",classification:"sound-physics-not-psychology",
    tags:result};
}

export function explainRegion(regionId, resonance, theory) {
  const index=scientificTrackIndex(resonance,theory), byId=Object.fromEntries(index.tags.map(x=>[x.id,x]));
  const relation={
    auditory:{ids:["brightness","texture","tonality"],
      heading:"Auditory feature processing",
      caveat:"Auditory cortex is broadly involved in hearing; this does not identify its activity in this listener."},
    rhythm:{ids:["beat"],heading:"Beat and motor prediction",
      caveat:"A measured tempo is not a stimulus-specific fMRI result. SMA participates in distributed beat and timing networks."},
    cerebellum:{ids:["beat"],heading:"Musical timing and coordination",
      caveat:"This association is from group neuroscience studies, not a measurement of this listener's cerebellum."},
    putamen:{ids:["beat"],heading:"Beat-based timing network",
      caveat:"The putamen is a deep structure; the external marker is symbolic, not neuroanatomical localization."},
    harmony:{ids:["tonality"],heading:"Harmonic processing",
      caveat:"Musical key and harmonic-expectation processing are distinct; named keys do not activate a dedicated IFG site."},
    reward:{ids:[],heading:"Individual music reward",
      caveat:"No audio-only features establish enjoyment, dopamine release, or activation of reward circuitry."}
  }[regionId];
  if(!relation)return {status:"no-mapping",message:"No reviewed auditory-feature association is catalogued."};
  const found=relation.ids.map(id=>byId[id]).filter(x=>x&&x.evidence!=="insufficient-evidence");
  const descriptions=found.slice(0,2).map(x=>x.value).join("; ");
  return {
    schema:"mcc.research.educational-region-note.v1",status:found.length?"educational-association":"not-measured",
    heading:relation.heading,observed:descriptions||"No reliable matching acoustic feature was measured",
    caveat:relation.caveat,
    claim:"Literature navigation only; no brain activation, diagnosis, genetic trait or listening-personality inference"
  };
}
