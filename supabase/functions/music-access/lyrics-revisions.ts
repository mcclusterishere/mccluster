/* Owner-authorized lyric revisions use the private append-only store.
   creator_tracks.lyrics is public/creator-writable content, never review authority.
   The pending SQL contract is required; there is deliberately no JSON fallback. */
type Doc = Record<string, any>;
function fail(message:string,status=400):never { throw Object.assign(new Error(message),{status}); }
export function validateLyrics(value:Doc) {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Lyrics are required');
 const lines=value.timed?.line;
 if(!Array.isArray(lines)||!lines.length||lines.length>2000)fail('Use 1–2000 timed lyric lines');
 if(new TextEncoder().encode(JSON.stringify(value)).length>512*1024)fail('Lyrics are too large',413);
 const doc:Doc={timed:{line:[]}};
 for(const k of ['title','artist','language'])if(typeof value[k]==='string')doc[k]=value[k];
 if(Number.isFinite(value.duration_seconds)&&value.duration_seconds>=0)doc.duration_seconds=value.duration_seconds;
 let prior=0;
 for(const line of lines){
  if(!line||typeof line.content!=='string'||!line.content.trim()||!Number.isFinite(line.begin)||line.begin<prior||line.begin<0)fail('Every line needs text and a nonnegative start time in order');
  if(line.end!=null&&(!Number.isFinite(line.end)||line.end<line.begin))fail('Line end must follow its start');
  if(line.words!=null&&!Array.isArray(line.words))fail('Word timings must be an array');
  const clean:Doc={begin:line.begin,content:line.content};if(line.end!=null)clean.end=line.end;
  // Editor annotations stay in the private version; SQL strips them from the public projection.
  for(const k of ['timing_estimated','mismatch','added'])if(typeof line[k]==='boolean')clean[k]=line[k];
  for(const k of ['heard','sheet'])if(typeof line[k]==='string')clean[k]=line[k];
  let wordStart=line.begin;
  if(line.words)clean.words=line.words.map((word:Doc)=>{
   if(!word||typeof word.content!=='string'||!Number.isFinite(word.begin)||!Number.isFinite(word.end)||word.begin<wordStart||word.end<word.begin||(line.end!=null&&word.end>line.end))fail('Word timings must stay ordered within their line');
   wordStart=word.begin;return {begin:word.begin,end:word.end,content:word.content};
  });
  doc.timed.line.push(clean);prior=line.begin;
 }
 doc.plain=doc.timed.line.map((l:Doc)=>l.content).join('\n');return doc;
}
async function rpc(admin:any,name:string,args:Doc) {
 const {data,error}=await admin.rpc(name,args);
 if(error){
  const message=String(error.message||'');
  if(error.code==='PGRST202'||error.code==='42883'||/schema cache|does not exist/i.test(message))fail('Private lyric revisions are not installed. Saving and approved exports are unavailable.',503);
  if(/lyric_revision_conflict/.test(message))fail('Lyrics or release changed. Export your draft, then reload before saving.',409);
  if(/lyric_operator_required|lyric_service_required|permission denied/.test(message))fail('Operator permission required',403);
  if(/lyric_revision_not_approved/.test(message))fail('That saved revision is not approved',409);
  if(/lyric_revision_hash_mismatch/.test(message))fail('The selected revision changed. Reload before exporting.',409);
  if(/track_not_found|lyric_revision_not_found/.test(message))fail('Track or revision not found',404);
  throw error;
 }
 if(!data||typeof data!=='object'||Array.isArray(data))fail('Invalid lyric revision response',502);
 return data;
}
export function getLyricRevision(admin:any,trackId:string,userId:string) {
 return rpc(admin,'music_lyrics_get',{p_actor:userId,p_track:trackId});
}
export function saveLyricRevision(admin:any,trackId:string,body:Doc,userId:string) {
 if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0||!/^[a-f0-9]{64}$/.test(body.expected_hash||'')||!body.expected_updated_at)fail('Reload the saved lyric revision before saving',409);
 return rpc(admin,'music_lyrics_save',{p_actor:userId,p_track:trackId,p_lyrics:validateLyrics(body.lyrics),p_reviewed:body.reviewed===true,p_expected_updated_at:body.expected_updated_at,p_expected_revision:body.expected_revision,p_expected_hash:body.expected_hash});
}
export function exportApprovedLyricRevision(admin:any,trackId:string,body:Doc,userId:string) {
 if(!Number.isSafeInteger(body.revision)||body.revision<1||!/^[a-f0-9]{64}$/.test(body.expected_hash||''))fail('Select a saved approved lyric revision',400);
 return rpc(admin,'music_lyrics_export',{p_actor:userId,p_track:trackId,p_revision:body.revision,p_expected_hash:body.expected_hash});
}
