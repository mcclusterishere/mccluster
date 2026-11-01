/* Versioned owner corrections in the existing creator_tracks.lyrics JSON.
   No master/audio columns are written; updated_at provides the row CAS. */
type Doc = Record<string, any>;
function fail(message:string,status=400):never { throw Object.assign(new Error(message),{status}); }
function stable(v:any):string { if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v); }
export async function lyricSnapshot(raw:Doc|null) {
 const lyrics=raw?structuredClone(raw):null;
 const revision=Number(lyrics?._revision?.number)||0,history=lyrics?._history||[];
 if(lyrics){delete lyrics._revision;delete lyrics._history;}
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(lyrics))))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {lyrics,revision,hash,history};
}
export function validateLyrics(value:Doc) {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Lyrics are required');
 const doc=structuredClone(value);delete doc._revision;delete doc._history;
 const lines=doc.timed?.line;
 if(!Array.isArray(lines)||!lines.length||lines.length>2000)fail('Use 1–2000 timed lyric lines');
 if(new TextEncoder().encode(JSON.stringify(doc)).length>512*1024)fail('Lyrics are too large',413);
 let prior=0;
 for(const line of lines){
  if(!line||typeof line.content!=='string'||!line.content.trim()||!Number.isFinite(line.begin)||line.begin<prior||line.begin<0)fail('Every line needs text and a nonnegative start time in order');
  if(line.end!=null&&(!Number.isFinite(line.end)||line.end<line.begin))fail('Line end must follow its start');
  if(line.words!=null&&!Array.isArray(line.words))fail('Word timings must be an array');
  let wordStart=line.begin;
  for(const word of line.words||[]){if(!word||typeof word.content!=='string'||!Number.isFinite(word.begin)||!Number.isFinite(word.end)||word.begin<wordStart||word.end<word.begin||(line.end!=null&&word.end>line.end))fail('Word timings must stay ordered within their line');wordStart=word.begin;}
  prior=line.begin;
 }
 doc.plain=lines.map((l:Doc)=>l.content).join('\n');return doc;
}
export async function saveLyricRevision(admin:any,trackId:string,body:Doc,userId:string) {
 const {data:track,error}=await admin.from('creator_tracks').select('id,lyrics,updated_at').eq('id',trackId).maybeSingle();
 if(error)throw error;if(!track)fail('Track not found',404);
 const prior=await lyricSnapshot(track.lyrics);
 if(body.expected_updated_at!==track.updated_at||body.expected_revision!==prior.revision||body.expected_hash!==prior.hash)fail('Lyrics or release changed. Export your draft, then reload before saving.',409);
 const doc=validateLyrics(body.lyrics),now=new Date().toISOString();
 doc.reviewed=body.reviewed===true;doc.reviewed_at=doc.reviewed?now:null;doc.reviewed_by=doc.reviewed?userId:null;
 const next=await lyricSnapshot(doc),revision=prior.revision+1;
 const history=prior.history.concat([{revision:prior.revision,hash:prior.hash,lyrics:prior.lyrics}]);
 const stored={...doc,_revision:{number:revision,sha256:next.hash,saved_at:now},_history:history};
 if(new TextEncoder().encode(JSON.stringify(stored)).length>8000000)fail('Revision history is full. No history was removed; export before continuing.',413);
 const result=await admin.from('creator_tracks').update({lyrics:stored}).eq('id',trackId).eq('updated_at',track.updated_at).select('id,lyrics,updated_at');
 if(result.error)throw result.error;if(!result.data?.length)fail('Release changed during save. Your draft has not overwritten it.',409);
 return {...await lyricSnapshot(result.data[0].lyrics),expected_updated_at:result.data[0].updated_at,track_id:trackId};
}
