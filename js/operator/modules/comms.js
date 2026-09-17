/* ============================================================
   COMMUNICATIONS CONSOLE.

   Queues · conversation list · conversation · inspector.

   The one thing this screen must never be ambiguous about is who owns
   a thread. An operator typing into a conversation the assistant still
   controls, or assuming a handover happened when it did not, is the
   failure mode that matters — so ownership is stated in the list, in
   the header, and in the composer's enabled state, and all three read
   from the same field.

   Backend reality: `GET /v1/comms/threads` is the only read. There is
   no per-thread message endpoint, so the conversation pane renders the
   messages the thread payload carries and says so when it carries none.
   ============================================================ */

import { all, endpoints } from '../api.js';
import { ago, button, dot, empty, esc, failure, fields, panel, pill, raw, stamp, toast } from '../ui.js';

const QUEUES = [
  ['all', 'All threads'],
  ['owner', 'Waiting for owner'],
  ['assistant', 'Assistant handling'],
  ['unread', 'Unread']
];

/* Ownership is read from whichever field the payload uses; the console
   normalizes once so nothing downstream guesses. */
function ownership(thread) {
  if (thread?.owner_active === true || thread?.state === 'owner' || thread?.owned_by === 'owner') return 'owner';
  if (thread?.needs_owner === true || thread?.state === 'needs_owner') return 'needs_owner';
  return 'assistant';
}

function ownerLabel(mode) {
  if (mode === 'owner') return pill('ok', 'you have it');
  if (mode === 'needs_owner') return pill('warn', 'wants you');
  return pill('ai', 'assistant');
}

function matchesQueue(thread, queue) {
  const mode = ownership(thread);
  if (queue === 'owner') return mode === 'needs_owner' || mode === 'owner';
  if (queue === 'assistant') return mode === 'assistant';
  if (queue === 'unread') return Boolean(thread?.unread || thread?.unread_count);
  return true;
}

function threadTitle(thread) {
  return thread?.contact_label || thread?.contact_name || thread?.contact
    || thread?.phone || thread?.handle || thread?.id || 'thread';
}

function messagesOf(thread) {
  const list = thread?.messages || thread?.recent_messages || thread?.turns;
  return Array.isArray(list) ? list : [];
}

function renderConversation(thread) {
  if (!thread) {
    return empty('Select a conversation.', 'Threads on the left. Nothing is fetched until you pick one.');
  }
  const messages = messagesOf(thread);
  const mode = ownership(thread);

  const body = messages.length
    ? `<div class="op-msgs">${messages.map((message) => {
        const fromOperator = /owner|operator|human|agent/i.test(String(message.role || message.direction || ''));
        const fromAssistant = /assistant|bot|ai/i.test(String(message.role || ''));
        return `
          <div class="op-msg ${fromOperator ? 'op-msg--out' : ''}">
            <p class="op-msg__meta">
              ${fromAssistant ? dot('ai') : dot(fromOperator ? 'ok' : 'idle')}
              ${esc(message.role || message.direction || 'message')}
              · ${esc(ago(message.occurred_at || message.created_at || message.at))}
              ${message.delivery_state ? ` · ${esc(message.delivery_state)}` : ''}
            </p>
            <p class="op-msg__body">${esc(message.content || message.body || message.text || '')}</p>
          </div>`;
      }).join('')}</div>`
    : `${empty('No messages in this payload.',
        'GET /v1/comms/threads returns thread state; it does not embed a full transcript for every thread.')}`;

  return `
    <div class="op-convo">
      <header class="op-convo__head">
        <div>
          <b>${esc(threadTitle(thread))}</b>
          <p class="op-state__hint" style="margin:.15rem 0 0">
            ${ownerLabel(mode)} · last activity ${esc(ago(thread.last_message_at || thread.updated_at))}
          </p>
        </div>
      </header>
      <div class="op-convo__body">${body}</div>
      <footer class="op-convo__foot">
        <textarea class="op-textarea" id="opReply" rows="2"
          placeholder="${mode === 'owner' ? 'Reply as the operator…' : 'Take the thread over before replying.'}"
          ${mode === 'owner' ? '' : 'disabled'}></textarea>
        <div style="display:flex;gap:.4rem;margin-top:.4rem;align-items:center">
          ${mode === 'owner'
            ? button('Send', { action: 'send', variant: 'primary' })
            : button('Send', { disabled: 'Take the thread over first — the assistant currently owns it.' })}
          ${mode === 'owner'
            ? button('Release to assistant', { action: 'release' })
            : button('Take over', { action: 'takeover', variant: 'primary' })}
        </div>
      </footer>
    </div>`;
}

function renderInspector(thread, transport) {
  if (!thread) {
    return transport.ok
      ? fields([
          ['Transport', esc(transport.data?.transport || '—')],
          ['Beta', esc(transport.data?.beta ?? '—')],
          ['Inbound', `<span class="op-mono">${esc(transport.data?.routes?.relay_inbound || '—')}</span>`],
          ['Outbox claim', `<span class="op-mono">${esc(transport.data?.routes?.relay_claim || '—')}</span>`],
          ['Delivery', `<span class="op-mono">${esc(transport.data?.routes?.relay_delivery || '—')}</span>`]
        ])
      : failure(transport);
  }
  const mode = ownership(thread);
  return `
    ${fields([
      ['Ownership', ownerLabel(mode)],
      ['Thread id', `<span class="op-mono">${esc(thread.id || '—')}</span>`],
      ['Contact', esc(threadTitle(thread))],
      ['Channel', esc(thread.channel || thread.transport || '—')],
      ['State', pill(thread.state || 'unknown')],
      ['Messages', String(messagesOf(thread).length)],
      ['Created', esc(stamp(thread.created_at))],
      ['Last activity', `${esc(stamp(thread.last_message_at || thread.updated_at))} <span class="op-state__hint">(${esc(ago(thread.last_message_at || thread.updated_at))})</span>`]
    ])}
    ${raw(thread, 'Thread payload')}`;
}

export default {
  async mount(root, { app, params, signal }) {
    const queue = params.queue || 'all';
    const sources = await all({
      transport: endpoints.comms(),
      threads: endpoints.commsThreads()
    });
    if (signal.aborted) return;

    if (!sources.threads.ok) {
      root.innerHTML = panel({ title: 'Communications', body: failure(sources.threads) });
      return;
    }

    const threads = sources.threads.data?.threads || [];
    let selectedId = params.thread || null;

    const draw = () => {
      const visible = threads.filter((thread) => matchesQueue(thread, queue));
      const selected = threads.find((thread) => String(thread.id) === String(selectedId)) || null;

      root.innerHTML = `
        <div class="op-cols op-cols--comms">
          <div class="op-panel">
            <header class="op-panel__head"><h2>Queues</h2></header>
            <div style="padding:.4rem">
              ${QUEUES.map(([id, label]) => {
                const n = threads.filter((thread) => matchesQueue(thread, id)).length;
                return `<button class="op-queue ${queue === id ? 'is-on' : ''}" data-queue="${id}">
                  <span>${esc(label)}</span><b>${n}</b></button>`;
              }).join('')}
            </div>
            <header class="op-panel__head" style="border-top:1px solid var(--op-line)"><h2>Transport</h2></header>
            <div style="padding:.5rem .7rem;font-size:.75rem;color:var(--op-dim)">
              ${sources.transport.ok
                ? `${dot('ok')} ${esc(sources.transport.data?.transport || 'relay')}`
                : `${dot('warn')} unreadable`}
            </div>
          </div>

          <div class="op-panel">
            <header class="op-panel__head">
              <h2>Threads</h2><span class="op-panel__meta">${visible.length} of ${threads.length}</span>
            </header>
            <div class="op-threadlist">
              ${visible.length ? visible.map((thread) => `
                <button class="op-thread ${String(thread.id) === String(selectedId) ? 'is-on' : ''}" data-thread="${esc(thread.id)}">
                  <span class="op-thread__top">
                    <b>${esc(threadTitle(thread))}</b>
                    <time>${esc(ago(thread.last_message_at || thread.updated_at))}</time>
                  </span>
                  <span class="op-thread__sub">
                    ${ownerLabel(ownership(thread))}
                    <em>${esc(thread.last_message_preview || thread.state || '')}</em>
                  </span>
                </button>`).join('')
                : empty('No threads in this queue.')}
            </div>
          </div>

          <div class="op-panel">${renderConversation(selected)}</div>

          <div class="op-panel">
            <header class="op-panel__head"><h2>${selected ? 'Thread' : 'Transport'}</h2></header>
            <div class="op-panel__body">${renderInspector(selected, sources.transport)}</div>
          </div>
        </div>`;

      root.querySelectorAll('[data-queue]').forEach((node) => {
        node.addEventListener('click', () => app.go('comms', { queue: node.getAttribute('data-queue'), ...(selectedId ? { thread: selectedId } : {}) }));
      });
      root.querySelectorAll('[data-thread]').forEach((node) => {
        node.addEventListener('click', () => { selectedId = node.getAttribute('data-thread'); draw(); });
      });

      const wire = (name, handler) => {
        const node = root.querySelector(`[data-action="${name}"]`);
        if (node) node.addEventListener('click', () => handler(node));
      };

      wire('takeover', async (node) => {
        node.disabled = true;
        const result = await endpoints.commsTakeover(selectedId);
        node.disabled = false;
        if (!result.ok) return toast(result.message || 'Takeover refused.', 'bad');
        toast('You own this thread.', 'ok');
        const thread = threads.find((candidate) => String(candidate.id) === String(selectedId));
        if (thread) { thread.owner_active = true; thread.state = 'owner'; thread.needs_owner = false; }
        draw();
      });

      wire('release', async (node) => {
        node.disabled = true;
        const result = await endpoints.commsRelease(selectedId);
        node.disabled = false;
        if (!result.ok) return toast(result.message || 'Release refused.', 'bad');
        toast('Released to the assistant.', 'ok');
        const thread = threads.find((candidate) => String(candidate.id) === String(selectedId));
        if (thread) { thread.owner_active = false; thread.state = 'assistant'; }
        draw();
      });

      wire('send', async (node) => {
        const box = root.querySelector('#opReply');
        const text = box.value.trim();
        if (!text) return toast('Nothing to send.', 'warn');
        node.disabled = true;
        const result = await endpoints.commsSend(selectedId, { body: text });
        node.disabled = false;
        if (!result.ok) return toast(result.message || 'Send refused.', 'bad');
        box.value = '';
        toast('Queued for delivery.', 'ok');
      });
    };

    draw();
  }
};
