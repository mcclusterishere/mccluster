/* Owner Finance panel mounted inside Halo's existing Markets globe surface. */
(function () {
  'use strict';
  function mount(root,G) {
    const esc=s=>G.esc(String(s??'')), usd=c=>'$'+(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    let alive=true,locked=false,seq=0,account=null,selected=null,market=null,pending=null,busy=false,searchTimer=0,valuationSeq=0,roster=null,dashboard=null;
    const messages={needs_key:'Connect Alpaca Paper credentials in the server secret store to enable US stock search and charts.',provider_disabled:'Alpaca data is paused by the owner. No prices are available.',finance_schema_not_ready:'Paper storage needs the reviewed database migration.',finance_persistence_disabled:'Paper storage is disabled.',not_found:'Finance is not enabled on this server.',key_rejected:'Alpaca rejected this connection. Check server credentials and permissions.',quote_not_eligible:'This quote cannot fill an order. Refresh during the regular session.',corporate_actions_review_required:'Earlier-session positions are frozen until corporate actions are supported. Archive/reset this simulation to start a new session.',conflict:'Another session changed the portfolio. Reload, then retry.',rate_limited:'Provider limit reached. Please wait before refreshing.',quota_exhausted:'Shared provider quota reached. Please wait.',provider_backoff:'Provider temporarily paused after a limit or outage.',insufficient_cash:'Not enough paper cash.',insufficient_shares:'Not enough shares to sell.'};
    const message=e=>messages[e.code]||String(e.code||'Request unavailable').replaceAll('_',' ');
    root.innerHTML='<h3>Finance</h3><p>Company evidence, market coverage and a private ownership baseline on the same globe.</p><section data-f-dashboard></section><section data-f-roster></section><h4>Paper simulation · separate from actual holdings</h4><p data-f-status role="status"></p>'+
      '<form data-f-search><label>Stock search<input data-f-query type="search" maxlength="40" placeholder="Symbol or company name" autocomplete="off"></label><button>Search</button></form><ul data-f-results></ul>'+
      '<div data-f-security></div><div data-f-ticket></div><div data-f-account></div>'+
      '<div data-f-valuation></div><button type="button" data-f-value>Refresh portfolio value</button><button type="button" data-f-reload>Reload portfolio</button><button type="button" data-f-retry hidden>Retry pending action</button>'+
      '<details><summary>Owner source and storage status</summary><button type="button" data-f-diagnose>Check connection</button><p data-f-control></p><p>Credentials stay in the server secret store. Source activation and storage configuration use the existing control plane.</p></details>';
    const $=s=>root.querySelector(s), status=$('[data-f-status]');
    async function ask(path,action) {
      const token=G.token();
      if(locked||!token){lock();throw {code:'forbidden'};}
      const r=await fetch(G.api+'/v1/intel/finance/'+path,{method:action?'POST':'GET',headers:{authorization:'Bearer '+token,accept:'application/json',...(action?{'content-type':'application/json'}:{})},body:action?JSON.stringify({orders:[action]}):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
      const d=await r.json().catch(()=>({}));
      if(locked||G.token()!==token){lock();throw {code:'forbidden',status:403};}
      if([401,403].includes(r.status)){lock();throw {code:'forbidden',status:r.status};}
      if(!r.ok)throw {code:d.code||d.detail?.code||'request_unavailable',status:r.status};
      return d;
    }
    function lock(){locked=true;seq++;if(roster)roster.clear();if(dashboard)dashboard.clear();clearValuation();selected=null;market=null;account=null;pending=null;root.querySelectorAll('input,button').forEach(x=>x.disabled=true);$('[data-f-security]').textContent='';$('[data-f-account]').textContent='';$('[data-f-ticket]').textContent='';$('[data-f-results]').textContent='';status.textContent='Owner authentication required.';}
    async function search(){const n=++seq;status.textContent='Searching Alpaca asset directory…';try{const d=await ask('market?q='+encodeURIComponent($('[data-f-query]').value.trim()));if(!alive||n!==seq)return;
      $('[data-f-results]').innerHTML=d.items.map(a=>'<li><button type="button" data-f-symbol="'+esc(a.symbol)+'">'+esc(a.symbol)+' · '+esc(a.name)+' · '+esc(a.mic)+'</button></li>').join('');status.textContent=d.items.length?'Alpaca US asset directory · select a security.':'No matching US security.';
    }catch(e){if(alive&&n===seq){$('[data-f-results]').textContent='';status.textContent=message(e);}}}
    async function choose(symbol,period='1Y'){
      const n=++seq;selected=symbol;if(roster)roster.select(symbol);market=null;paintTicket();$('[data-f-security]').textContent='Loading '+symbol+'…';
      try{const d=await ask('market?symbol='+encodeURIComponent(symbol)+'&period='+period);if(!alive||n!==seq)return;market=d;paintSecurity();paintTicket();status.textContent='PAPER only. Quotes are IEX venue data, not consolidated US prices.';}
      catch(e){if(alive&&n===seq){market=null;$('[data-f-security]').textContent=message(e);paintTicket();}}
    }
    function paintSecurity(){
      const q=market?.quote,h=market?.history,bars=h?.bars||[],instrument=q?.instrument||h?.instrument;
      let plot='';
      if(bars.length){const ys=bars.map(b=>b.close),lo=Math.min(...ys),hi=Math.max(...ys),ts=bars.map(b=>Date.parse(b.at)),start=ts[0],end=ts.at(-1);
        plot='<p>Adjusted close range: '+usd(lo*100)+' – '+usd(hi*100)+'</p><svg class="hm__chart" viewBox="0 0 300 120" role="img" aria-label="Historical adjusted closes">'+bars.map((b,i)=>'<circle r="2" cx="'+(12+276*(ts[i]-start)/(end-start||1)).toFixed(2)+'" cy="'+(hi===lo?60:108-96*(b.close-lo)/(hi-lo)).toFixed(2)+'"/>').join('')+'</svg><p>'+esc(bars[0].at.slice(0,10))+' to '+esc(bars.at(-1).at.slice(0,10))+'</p>';
      }
      $('[data-f-security]').innerHTML='<h4>'+esc(instrument?.name||selected)+' · '+esc(selected)+'</h4><p>'+esc(instrument?.mic||'Listing unavailable')+' · USD · US listing location is not operational exposure.</p>'+
        '<p>'+ (q?esc(q.status)+' · IEX only · market '+esc(q.session)+' · bid '+(q.bid===null?'—':usd(q.bid*100))+' / ask '+(q.ask===null?'—':usd(q.ask*100))+' · '+esc(q.as_of||'timestamp unavailable'):esc(message({code:market?.quote_error})))+'</p>'+
        '<label>History<select data-f-period><option value="1M">1 month</option><option value="1Y">1 year</option><option value="5Y">5 years</option></select></label><button type="button" data-f-refresh>Refresh selected security</button>'+plot+
        '<p>'+esc(h?.note||message({code:market?.history_error}))+(h?.truncated?' Partial response; history truncated.':'')+'</p>'+
        '<button type="button" data-f-watch>Add to watchlist</button><p>Ownership, board, resources and supply exposure: no verified dataset connected. Use country news below as context, not proof of company exposure.</p>';
      $('[data-f-period]').value=h?.period||'1Y';
    }
    function paintTicket(){
      const q=market?.quote,eligible=!!(q?.eligible&&Date.now()-Date.parse(q.as_of)<=30000),box=$('[data-f-ticket]');
      box.innerHTML='<h4>Paper order</h4><p>Preview uses the displayed quote. Confirm fetches a fresh eligible IEX quote; the simulated fill can differ. Whole shares only. No real money.</p>'+
        '<form data-f-order><label>Side<select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label>Shares<input name="quantity" type="number" min="1" max="10000" step="1" value="1" required></label><button '+(!eligible||!account||busy||pending?'disabled':'')+'>Preview order</button></form><p data-f-estimate></p><button type="button" data-f-confirm hidden>Confirm paper order</button>'+
        (!eligible?'<p>Orders unavailable until a fresh IEX quote arrives during the regular session.</p>':'');
    }
    function paintAccount(){if(!account)return;
      $('[data-f-account]').innerHTML='<h4>Paper portfolio</h4><p>Cash '+usd(account.cash_cents)+' · realized '+usd(account.realized_cents)+' · saved revision '+account.revision+'</p><ul>'+account.positions.map(p=>'<li>'+esc(p.symbol)+' · '+p.quantity+' shares · cost basis '+usd(p.cost_cents)+'</li>').join('')+'</ul><p>Cost basis is not current market value. Select a holding to inspect its latest quote.</p>'+
      '<div>'+account.positions.map(p=>'<button type="button" data-f-symbol="'+esc(p.symbol)+'">'+esc(p.symbol)+'</button>').join('')+'</div><h4>Watchlist</h4><ul>'+account.watchlist.map(s=>'<li><button type="button" data-f-symbol="'+esc(s)+'">'+esc(s)+'</button><button type="button" data-f-unwatch="'+esc(s)+'">Remove</button></li>').join('')+'</ul>'+
      '<details><summary>Saved paper fills ('+account.fills.length+')</summary><ul>'+account.fills.slice(-30).reverse().map(f=>'<li>'+esc(f.side)+' '+f.quantity+' '+esc(f.symbol)+' at '+usd(f.price_cents)+' · '+esc(f.at)+' · '+esc(f.quote.feed)+'</li>').join('')+'</ul></details><p>'+account.limitations.map(esc).join(' · ')+'</p><button type="button" data-f-reset>Archive session and reset paper cash</button>';
    }
    function clearValuation(){valuationSeq++;$('[data-f-valuation]').textContent='';}
    async function refreshValuation(){
      if(busy||pending||!account)return;
      const n=++valuationSeq,revision=account.revision,box=$('[data-f-valuation]');
      box.textContent='Checking sourced holding quotes…';
      try{const {valuation:v}=await ask('valuation');if(!alive||locked||n!==valuationSeq)return;
        if(v.revision!==revision||account?.revision!==revision){box.textContent='Portfolio changed. Reload before valuing it.';return;}
        box.innerHTML='<h4>Indicative paper value</h4><p>'+esc(v.basis)+'</p><p>Snapshot '+esc(v.generated_at)+' · '+esc(v.status)+'</p>'+
          (v.equity_cents===null?'<p>Portfolio total unavailable: one or more holdings cannot be valued.</p>':'<p>Paper equity '+usd(v.equity_cents)+' · holdings '+usd(v.holdings_cents)+' · unrealized '+usd(v.unrealized_cents)+'</p>')+
          '<ul>'+v.marks.map(m=>'<li>'+esc(m.symbol)+' · '+(m.value_cents===null?esc(message({code:m.reason})):usd(m.value_cents))+' · '+esc(m.source?.as_of||'No eligible timestamp')+'</li>').join('')+'</ul>'+
          (v.truncated?'<p>Only the first 30 holdings were checked. No complete total is shown.</p>':'')+'<p>'+esc(v.note)+'</p>';
      }catch(e){if(alive&&!locked&&n===valuationSeq)box.textContent=message(e);}
    }
    async function reload(){clearValuation();try{const d=await ask('account');if(!alive||locked)return;account=d.account;paintAccount();paintTicket();status.textContent='Paper portfolio loaded.';}catch(e){if(alive&&!locked){account=null;$('[data-f-account]').textContent=message(e);paintTicket();}}}
    async function submit(action){if(busy)return;if(pending && action!==pending){status.textContent='Resolve the pending action before submitting another.';return;}
      pending=action;busy=true;clearValuation();paintTicket();status.textContent='Saving paper action…';
      try{const d=await ask('account',pending);if(!alive||locked)return;account=d.account;pending=null;paintAccount();status.textContent='Paper action saved. No brokerage order was sent.';}
      catch(e){if(!alive||locked)return;status.textContent=message(e);if(e.status&&e.status<500&&e.status!==429)pending=null;}
      finally{busy=false;if(alive&&!locked){$('[data-f-retry]').hidden=!pending;paintTicket();}}
    }
    const action=(type,extra={})=>({id:crypto.randomUUID(),type,...extra});
    root.addEventListener('submit',e=>{e.preventDefault();if(e.target.matches('[data-f-search]'))search();if(e.target.matches('[data-f-order]')){
      const data=new FormData(e.target),side=data.get('side'),quantity=Number(data.get('quantity')),q=market?.quote;
      if(!q?.eligible||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)return;
      const a=action('order',{symbol:selected,side,quantity});
      $('[data-f-estimate]').textContent=side+' '+quantity+' '+selected+' · indicative '+usd((side==='buy'?q.ask:q.bid)*100*quantity)+'. Confirm may use a different fresh price.';
      const b=$('[data-f-confirm]');b.hidden=false;b.onclick=()=>submit(a);
    }});
    root.addEventListener('change',e=>{if(e.target.matches('[data-f-period]'))choose(selected,e.target.value);if(e.target.closest('[data-f-order]')){$('[data-f-confirm]').hidden=true;$('[data-f-estimate]').textContent='';}});
    root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
      if(b.dataset.fSymbol)choose(b.dataset.fSymbol);
      if(b.hasAttribute('data-f-refresh')&&selected)choose(selected,$('[data-f-period]')?.value||'1Y');
      if(b.hasAttribute('data-f-watch')&&selected)submit(action('watch',{symbol:selected}));
      if(b.dataset.fUnwatch)submit(action('unwatch',{symbol:b.dataset.fUnwatch}));
      if(b.hasAttribute('data-f-reload'))reload();
      if(b.hasAttribute('data-f-value'))refreshValuation();
      if(b.hasAttribute('data-f-retry')&&pending)submit(pending);
      if(b.hasAttribute('data-f-reset')&&confirm('Archive the current paper session and reset cash to $10,000? Saved events remain in the audit ledger.'))submit(action('reset'));
      if(b.hasAttribute('data-f-diagnose'))ask('control').then(d=>{if(alive)$('[data-f-control]').textContent='Alpaca '+(d.alpaca?.configured?'credentials present':'not connected')+' · '+(d.alpaca?.enabled?'enabled':'paused')+' · IEX · storage '+d.storage;}).catch(e=>{if(alive)$('[data-f-control]').textContent=message(e);});
    });
    const onStorage=e=>{if(e.key===null||e.key==='mccdb_session')lock();};window.addEventListener('storage',onStorage);
    if(window.HaloFinanceDashboard)dashboard=window.HaloFinanceDashboard.mount($('[data-f-dashboard]'),G,ask);
    if(window.HaloFinanceRoster)roster=window.HaloFinanceRoster.mount($('[data-f-roster]'),G,ask);
    reload();search();
    return {selectLeadership(symbol,mic){roster?.select(symbol,mic);},setVisible(value){roster?.setVisible(value);},destroy(){dashboard?.destroy();roster?.destroy();alive=false;seq++;clearTimeout(searchTimer);window.removeEventListener('storage',onStorage);root.textContent='';}};
  }
  window.HaloFinance=Object.freeze({mount});
})();
