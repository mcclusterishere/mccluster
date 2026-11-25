/* Halo-only simulation. No brokerage order API. Append-only server-valued events. */
import {rpc, IntelError} from '../intel/store.js';
import {FinanceDataError,securitySymbol} from './alpaca.js';
const fail = (code,status=400) => { throw new IntelError(code,status,code); };
const safe = n => Number.isSafeInteger(n) ? n : fail('amount_overflow');
const cents = n => { const v=Math.round(n*100); if (!Number.isSafeInteger(v)||v<=0)fail('invalid_quote'); return v; };
export function validateAction(a) {
  if (!a || typeof a!=='object' || !/^[a-zA-Z0-9-]{1,64}$/.test(a.id || '')) fail('invalid_action');
  const keys=Object.keys(a).sort().join(',');
  if (a.type==='order') {
    if(keys!=='id,quantity,side,symbol,type' || !['buy','sell'].includes(a.side) || !Number.isSafeInteger(a.quantity)||a.quantity<1||a.quantity>10000) fail('invalid_order');
  } else if (['watch','unwatch'].includes(a.type)) { if(keys!=='id,symbol,type')fail('invalid_action'); }
  else if(a.type==='reset') {if(keys!=='id,type')fail('invalid_action');}
  else fail('invalid_action');
  if(a.type!=='reset')securitySymbol(a.symbol);
  return JSON.stringify([a.type,a.symbol||null,a.side||null,a.quantity||null]);
}
export function replayAccount(events=[]) {
  if(!Array.isArray(events)||events.length>500)fail('ledger_invalid',503);
  let cash=1000000,realized=0,positions={},fills=[],session=null;
  const watch=new Set(),seen=new Set();
  for(const e of events){
    const a=e.action; validateAction(a);if(seen.has(a.id))fail('ledger_invalid',503);seen.add(a.id);
    if(a.type==='reset'){cash=1000000;realized=0;positions={};fills=[];session=null;continue;}
    if(a.type==='watch'){watch.add(a.symbol);continue;}
    if(a.type==='unwatch'){watch.delete(a.symbol);continue;}
    if(!e.quote || !e.instrument || e.instrument.symbol!==a.symbol || !Number.isSafeInteger(e.price_cents)||e.price_cents<=0)fail('ledger_invalid',503);
    const p=positions[a.symbol] || {symbol:a.symbol,instrument:e.instrument,quantity:0,cost_cents:0};
    const gross=safe(e.price_cents*a.quantity);
    if(a.side==='buy'){
      if(gross>cash)fail('insufficient_cash');cash=safe(cash-gross);p.quantity=safe(p.quantity+a.quantity);p.cost_cents=safe(p.cost_cents+gross);
    }else{
      if(a.quantity>p.quantity)fail('insufficient_shares');
      const basis=a.quantity===p.quantity?p.cost_cents:Math.round(p.cost_cents*a.quantity/p.quantity);
      cash=safe(cash+gross);realized=safe(realized+gross-basis);p.quantity-=a.quantity;p.cost_cents-=basis;
    }
    positions[a.symbol]=p;session=e.session;fills.push({id:a.id,...a,price_cents:e.price_cents,at:e.at,quote:e.quote});
  }
  return {mode:'paper-iex-v1',currency:'USD',cash_cents:cash,realized_cents:realized,positions:Object.values(positions).filter(p=>p.quantity),watchlist:[...watch],fills,session,
    limitations:['Halo simulation at observed bid/ask; no brokerage orders','Whole shares, long only; no liquidity, fees or tax model','Positions from earlier sessions require reset; dividends/splits are not automated','Cost basis is not current market value; request a separately timestamped indicative valuation']};
}
const easternDay = date => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export async function accountRequest(env,owner,action,market,{call=rpc,now=Date.now}={}){
  if(!/^[a-f0-9-]{36}$/i.test(owner||''))fail('forbidden',403);
  try{
    const stored=await call(env,'finance_account_read',{p_owner:owner});
    if(!stored||!Number.isSafeInteger(stored.revision)||!Array.isArray(stored.events))fail('ledger_invalid',503);
    let result=stored, portfolio=replayAccount(stored.events);
    if(action){
      const signature=validateAction(action),old=stored.events.find(e=>e.action.id===action.id);
      if(old){if(validateAction(old.action)!==signature)fail('idempotency_conflict',409);}
      else{
        if(stored.events.length>=500)fail('ledger_capacity',409);
        const event={action,at:new Date(now()).toISOString()};
        if(action.type==='watch'){
          await market.asset(env,action.symbol);
          if(!portfolio.watchlist.includes(action.symbol)&&portfolio.watchlist.length>=30)fail('watchlist_capacity');
        }
        if(action.type==='order'){
          const day=easternDay(new Date(now()));
          if(portfolio.positions.length && portfolio.session!==day)fail('corporate_actions_review_required',409);
          const q=await market.quote(env,action.symbol,{fresh:true});
          const age=now()-Date.parse(q.as_of);
          if(!q.eligible||q.status!=='real_time'||q.session!=='open'||q.feed!=='iex'||q.currency!=='USD'||!Number.isFinite(age)||age< -1000||age>30000)throw new FinanceDataError('quote_not_eligible',409);
          const position=portfolio.positions.find(p=>p.symbol===action.symbol);
          if(position && position.instrument.id!==q.instrument.id)fail('instrument_identity_changed',409);
          event.quote=q;event.instrument=q.instrument;event.session=day;
          event.price_cents=cents(action.side==='buy'?q.ask:q.bid);
        }
        replayAccount([...stored.events,event]);
        result=await call(env,'finance_account_append',{p_owner:owner,p_expected:stored.revision,p_event:event});
      }
      portfolio=replayAccount(result.events);
    }
    return {...portfolio,persisted:true,revision:result.revision};
  }catch(e){if(e.code==='intel_schema_not_ready')fail('finance_schema_not_ready',503);throw e;}
}
