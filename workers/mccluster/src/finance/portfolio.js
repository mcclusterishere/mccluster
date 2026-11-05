import { rpc, IntelError } from '../intel/store.js';
import { replayDemo, PaperError } from './paper.js';
export async function portfolioRequest(env, ownerId, command = null, call = rpc) {
  if (!/^[a-f0-9-]{36}$/i.test(ownerId || '')) throw new IntelError('Owner identity unavailable',403,'forbidden');
  try {
    const stored = await call(env,'finance_paper_read',{p_owner:ownerId});
    if (!stored || !Array.isArray(stored.commands) || !Number.isSafeInteger(stored.revision)) throw new IntelError('Portfolio invalid',503,'portfolio_invalid');
    let result=stored;
    if (command !== null) {
      const previous=stored.commands.find(x=>x.id===command?.id);
      // Validate keys, side and quantity even on retries; never trust client cash/prices.
      replayDemo([...stored.commands,command]);
      if (!previous) result=await call(env,'finance_paper_append',{p_owner:ownerId,p_expected:stored.revision,p_commands:[...stored.commands,command]});
    }
    const portfolio=replayDemo(result.commands);
    return {...portfolio,persisted:true,revision:result.revision,
      limitations:portfolio.limitations.filter(x=>!x.startsWith('Resets')),
      provenance:{kind:'synthetic',source:'McCluster synthetic-v1 scenario',prices:'Not exchange or vendor data'}};
  } catch(error) {
    if(error.code==='intel_schema_not_ready') throw new IntelError('Finance persistence schema is not applied',503,'finance_schema_not_ready');
    if(error instanceof PaperError || error instanceof IntelError)throw error;
    throw new IntelError('Portfolio store unavailable',503,'portfolio_unavailable');
  }
}
