// Test-only PostgREST double. Unique PK + serial chain trigger effects are atomic here;
// this is not a replacement for a PostgreSQL integration/concurrency test.
export function evidenceDb() {
  const tables = { learning_lab_sessions: [], learning_evidence_events: [] }, calls = [];
  let loseNextInsertAck = false, failClose = false;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url), method = init.method || 'GET', table = u.pathname.replace('/rest/v1/', ''), rows = tables[table];
    if (!rows) throw new Error('Unexpected test request: ' + table);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, table, body, search: u.search });
    const match = row => [...u.searchParams].every(([k, v]) => v.startsWith('eq.') ? String(row[k]) === v.slice(3) : v.startsWith('in.(') ? v.slice(4,-1).split(',').includes(String(row[k])) : true);
    if (method === 'GET') return json(rows.filter(match).sort((a,b)=>u.searchParams.get('order')==='ended_at.desc,id.desc' ? String(b.ended_at).localeCompare(String(a.ended_at)) || b.id.localeCompare(a.id) : (a.seq||0)-(b.seq||0)).slice(0,Number(u.searchParams.get('limit'))||1000));
    if (method === 'POST') {
      if (rows.some(r=>r.id===body.id)) return json({message:'duplicate key'},409);
      const row=structuredClone(body);
      if (table === 'learning_lab_sessions') Object.assign(row,{outcome:'in_progress',started_at:new Date().toISOString(),last_event_seq:0});
      else {
        const session=tables.learning_lab_sessions.find(s=>s.id===row.session_id && s.user_id===row.user_id);
        if (!session || session.outcome!=='in_progress') return json({message:'session closed'},400);
        row.seq=++session.last_event_seq;row.event_hash=String(row.seq).padStart(64,'a');
      }
      rows.push(row);
      if (loseNextInsertAck && table==='learning_evidence_events') {loseNextInsertAck=false;throw new Error('Lost ACK after commit');}
      return json([row],201);
    }
    if (method==='PATCH') {
      if (failClose) {failClose=false;return json({message:'temporary close failure'},503);}
      const hits=rows.filter(match);for(const row of hits)Object.assign(row,body);return json(hits);
    }
    return json({},405);
  }
  return { tables, calls, fetchImpl, loseAck:()=>{loseNextInsertAck=true;}, failClose:()=>{failClose=true;} };
}
