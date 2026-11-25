// Reject drift between the lightweight pre-load policy and its generated geometry.
export function validateRegion(data,policy){
 if(data.contract?.id!==policy.id||data.contract.revision!==policy.revision||data.provenance?.contractSha256!==policy.contractSha256||JSON.stringify(data.contract.gating)!==JSON.stringify(policy.gating)||JSON.stringify(data.contract.frame?.anchor)!==JSON.stringify(policy.anchor))throw Error('Region policy or revision mismatch');
 if(!data.graphs?.hex||!data.graphs?.square||Object.values(data.graphs).some(g=>!Array.isArray(g.nodes)||g.nodes.length>policy.gating.maxNodesPerTopology))throw Error('Region node budget exceeded');
 if(!Array.isArray(data.roads)||!Array.isArray(data.buildings)||data.roads.length+data.buildings.length+2>policy.gating.maxEntities)throw Error('Region entity budget exceeded');
 return data;
}
export async function readRegion(response,policy){
 if(!response.ok)throw Error('Region unavailable');
 const limit=policy.gating.maxAssetBytes,reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw Error('Region byte budget exceeded');chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 return validateRegion(JSON.parse(new TextDecoder().decode(body)),policy);
}
export function visibleCells(region,topology,position){
 const available=region.contract.gating.maxEntities-region.roads.length-region.buildings.length-2;
 return region.graphs[topology].nodes.filter(n=>region.contract.revision===1||Math.hypot(n.position.x-position.x,n.position.z-position.z)<45)
  .sort((a,b)=>Math.hypot(a.position.x-position.x,a.position.z-position.z)-Math.hypot(b.position.x-position.x,b.position.z-position.z)||a.id.localeCompare(b.id)).slice(0,Math.max(0,available));
}
