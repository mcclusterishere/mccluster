/* INTEGRATIONS — inbound webhooks and outbound connectors that exist. */
import { all, endpoints } from '../api.js';
import { esc, panel, pill, table } from '../ui.js';

const WEBHOOKS = [
  { name:'fal media callback', path:'/v1/media/webhooks/fal', method:'POST', direction:'inbound',
    note:'Provider posts generation results back to the Worker.' },
  { name:'Meta social webhook', path:'/v1/social/webhooks/meta', method:'GET, POST', direction:'inbound',
    note:'Verification handshake plus delivery/insight events.' },
  { name:'Stripe (Whip)', path:'/api/stripe/webhook', method:'POST', direction:'inbound',
    note:'Payment events for the Whip product.' },
  { name:'Comms relay inbound', path:'/v1/comms/relay/inbound', method:'POST', direction:'inbound',
    note:'Android/SIM relay delivers received messages.' },
  { name:'Comms outbox claim', path:'/v1/comms/relay/outbox/claim', method:'POST', direction:'outbound',
    note:'Relay device claims queued outbound messages.' },
  { name:'Comms delivery receipt', path:'/v1/comms/relay/delivery', method:'POST', direction:'inbound',
    note:'Relay reports delivery state.' },
  { name:'Remote MCP', path:'/v1/core/mcp', method:'POST', direction:'inbound',
    note:'Model clients reach Core through the OAuth-gated bridge.' },
  { name:'Media MCP', path:'/v1/media/mcp', method:'POST', direction:'inbound',
    note:'Generative-media MCP surface.' }
];

export default {
  async mount(root, { signal }) {
    const s = await all({ bridge: endpoints.coreBridge() });
    if (signal.aborted) return;
    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Webhook & connector surface', meta:`${WEBHOOKS.length}`, body: table([
        { key:'name', label:'Integration' },
        { key:'path', label:'Route', render:(r)=>`<span class="op-mono">${esc(r.path)}</span>` },
        { key:'method', label:'Method' },
        { key:'direction', label:'Direction', render:(r)=>pill(r.direction==='inbound'?'busy':'idle', r.direction) },
        { key:'note', label:'Purpose' }
      ], WEBHOOKS, { idKey:'path' }) })}
      ${panel({ title:'Delivery history', body: `
        <p class="op-state__hint" style="margin:0">
          Routes above are read from the Worker source, so the list is accurate. There is no
          webhook-delivery log endpoint, so this console cannot show whether a given hook fired or
          failed — the honest state is "unknown", not an empty success list.
        </p>` })}
    </div>`;
  }
};
