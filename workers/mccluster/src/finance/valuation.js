/* Read-only mark of Halo's paper holdings. Never writes or submits an order. */
import { accountRequest } from './account.js';
const day = t => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export async function valueAccount(env, owner, market, {call, now=Date.now}={}) {
  const account = await accountRequest(env, owner, null, market, {call,now});
  const started=now(), holdings=account.positions.slice(0,30), marks=new Array(holdings.length);
  let cursor=0;
  async function worker() {
    while(cursor<holdings.length) {
      const i=cursor++, p=holdings[i];
      const row={symbol:p.symbol,quantity:p.quantity,cost_cents:p.cost_cents,value_cents:null,unrealized_cents:null,status:'unavailable'};
      marks[i]=row;
      // An unadjusted position cannot be marked across a possible corporate action.
      if(account.session!==day(started)){row.reason='corporate_actions_review_required';continue;}
      try {
        const q=await market.quote(env,p.symbol);
        row.source={provider:q.provider,feed:q.feed,as_of:q.as_of,received_at:q.received_at,session:q.session};
        const age=now()-Date.parse(q.as_of), price=Math.round(q.bid*100), value=price*p.quantity;
        if(q.instrument?.id!==p.instrument.id){row.reason='instrument_identity_changed';continue;}
        if(q.provider!=='alpaca'||q.feed!=='iex'||q.currency!=='USD'||q.status!=='real_time'||q.session!=='open'||!Number.isFinite(age)||age< -1000||age>30000||!Number.isFinite(q.bid)||q.bid<=0||!Number.isSafeInteger(price)||price<=0||!Number.isSafeInteger(value)){
          row.reason='quote_not_eligible';continue;
        }
        row.status='marked';row.value_cents=value;row.unrealized_cents=value-p.cost_cents;
      } catch(e) { row.reason=['needs_key','provider_disabled','key_rejected','quota_exhausted','rate_limited','provider_backoff','connection_changed'].includes(e.code)?e.code:'quote_unavailable'; }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,holdings.length)},worker));
  const finished=now();
  // A slow batch must not turn individually fresh but now-expired prices into a total.
  for(const m of marks) if(m.status==='marked'&&(finished-Date.parse(m.source.as_of)>30000||day(finished)!==account.session)) {
    m.status='unavailable';m.reason='quote_expired';m.value_cents=null;m.unrealized_cents=null;
  }
  const truncated=account.positions.length>holdings.length, complete=!truncated&&marks.every(m=>m.status==='marked');
  const sum=marks.reduce((n,m)=>n+(m.value_cents??0),0), total=account.cash_cents+sum;
  const safe=Number.isSafeInteger(total)&&Number.isSafeInteger(sum);
  return {revision:account.revision,currency:'USD',basis:'IEX bid; indicative liquidation value, not an executable consolidated price',
    generated_at:new Date(finished).toISOString(),status:complete&&safe?'complete':'partial',truncated,holdings_count:account.positions.length,marks,
    cash_cents:account.cash_cents,holdings_cents:complete&&safe?sum:null,equity_cents:complete&&safe?total:null,
    unrealized_cents:complete&&safe?marks.reduce((n,m)=>n+m.unrealized_cents,0):null,
    note:'Snapshot only. No fees, liquidity or slippage model. A missing, stale, closed-session or unadjusted holding prevents a portfolio total.'};
}
