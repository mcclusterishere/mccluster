const $ = id => document.getElementById(id);
let orders = [], generation = 0, sessionToken = '', pending = null;
function token() { try { return JSON.parse(localStorage.getItem('mccdb_session') || 'null')?.access_token || ''; } catch { return ''; } }
const api = ['localhost','127.0.0.1'].includes(location.hostname) ? '/v1/intel/finance' : 'https://api.mccluster.org/v1/intel/finance';
const messages = { insufficient_shares: 'You do not have enough DEMO shares to sell.', insufficient_cash: 'You do not have enough practice cash.',
  invalid_order: 'Enter a whole number of shares between 1 and 10,000.', too_many_orders: 'This practice session has reached 100 orders. Reset to start again.',
  finance_persistence_disabled: 'Portfolio storage is disabled. No order has been saved.', finance_schema_not_ready: 'Portfolio storage schema is not ready. No order has been saved.', conflict: 'Portfolio changed in another session. Reload before trying again.', forbidden: 'Owner access is required.', not_found: 'Finance development is not enabled.' };
async function ask(path, body) {
  const current = token();
  if (!current || current !== sessionToken) throw new Error('Session changed. Retry owner access.');
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { authorization: 'Bearer ' + current, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if ([401,403,404].includes(response.status)) lock(); const error=new Error(messages[data.code] || `Request unavailable (${response.status}). Reload the portfolio before trying again.`);error.status=response.status;throw error; }
  return data;
}
function lock() { generation++; orders = []; pending=null; $('workspace').hidden = true; $('fills').replaceChildren(); $('balances').replaceChildren(); }
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function render(p) {
  $('balances').replaceChildren();
  for (const [name,value] of [['Practice cash',money(p.cash_cents)],['DEMO shares',p.shares],['Synthetic equity',money(p.equity_cents)],['Fixture observation',p.freshness.as_of]]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent=name;dd.textContent=value;$('balances').append(dt,dd);
  }
  $('fills').replaceChildren();
  for (const fill of p.fills) { const li=document.createElement('li');li.textContent=`${fill.side} ${fill.quantity} DEMO at ${money(fill.price_cents)} — synthetic`;$('fills').append(li); }
}
async function start() {
  lock(); sessionToken=token(); const seq=generation;
  $('gate').textContent='Checking owner access…';
  try {
    const manifest=await ask(''); const reference=await ask('/reference');
    if(seq!==generation)return;
    $('sources').replaceChildren();
    for(const [name,source] of Object.entries(manifest.sources)){const li=document.createElement('li');li.textContent=`${name === 'sec' ? 'SEC' : name === 'house' ? 'House disclosures' : 'Senate disclosures'}: ${source.collection === 'blocked_pending_review' ? 'not connected; access and use review pending' : 'not connected'}`;$('sources').append(li);}
    $('controls').textContent=`Development: ${manifest.controls.development ? 'enabled' : 'disabled'}. Portfolio storage: ${manifest.controls.persistence ? 'enabled' : 'disabled'}. Customer release and collection: disabled.`;
    $('reference-status').textContent=`Static repository reference, version ${reference.version}. Not live venue status or prices. ${reference.coordinates}`;
    $('reference').replaceChildren();
    for(const venue of reference.exchanges){const li=document.createElement('li');li.textContent=`${venue.name} (${venue.mic}) · ${venue.city}, ${venue.country}`;$('reference').append(li);}
    const cite=document.createElement('li');cite.textContent='Sources recorded in reference: '+reference.sources.join('; ');$('reference').append(cite);
    $('workspace').hidden=false;$('gate').textContent='Owner development access confirmed. Synthetic sandbox only.';$('result').textContent='Loading saved portfolio…';
    try { const saved=await ask('/portfolio');if(seq!==generation)return;render(saved.portfolio);$('result').textContent='Saved synthetic portfolio loaded.'; } catch(error){$('result').textContent=error.message;}
  } catch(error){if(seq===generation)$('gate').textContent=error.message;else $('gate').textContent='Owner access unavailable or development disabled.';}
}
$('diagnose').onclick=async()=>{try{const d=await ask('/control');$('diagnosis').textContent=`Storage: ${d.storage}. Collection: disabled. No customer release.`;}catch(error){$('diagnosis').textContent=error.message;}};
$('retry').onclick=start; $('reset').onclick=start;
$('order').onsubmit=async event=>{
  event.preventDefault(); const seq=generation, button=event.submitter;button.disabled=true;
  pending ||= {id:crypto.randomUUID(),side:event.target.elements.side.value,quantity:Number(event.target.elements.quantity.value)};
  try {const data=await ask('/portfolio',{orders:[pending]});if(seq!==generation)return;pending=null;render(data.portfolio);$('result').textContent='Synthetic order filled and saved.';}
  catch(error){if(seq!==generation)return;if(error.status && error.status<500)pending=null;$('result').textContent=error.message+(pending?' Save outcome is uncertain. Submit again to retry the same order, or reload to inspect saved fills.':'');if($('workspace').hidden)$('gate').textContent='Owner access unavailable. Retry after signing in.';}
  finally{button.disabled=false;}
};
window.addEventListener('storage',event=>{if(event.key==='mccdb_session'){lock();$('gate').textContent='Session changed. Retry owner access.';}});
start();
