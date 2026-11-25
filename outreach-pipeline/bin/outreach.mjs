#!/usr/bin/env node
/* mccluster-outreach: run the research pipeline, review the queue, record sends and replies, report per frame.
   There is deliberately no "send" command. Letters go out only after Matthew approves them in chat;
   the send itself happens outside this tool and is recorded here with record-send. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, nyDay } from '../src/config.mjs';
import { LocalStore, SupabaseStore } from '../src/store.mjs';
import { loadHistory, parseCsv } from '../src/history.mjs';
import { createSearch } from '../src/search.mjs';
import { createFetcher } from '../src/fetch-page.mjs';
import { createLlm, createEmbedder } from '../src/llm.mjs';
import { llmComposer } from '../src/compose.mjs';
import { runDaily } from '../src/pipeline.mjs';
import { approveDraft, rejectDraft, editDraft, reviewMarkdown } from '../src/review.mjs';
import { recordSend } from '../src/send.mjs';
import { recordReply, frameStats } from '../src/tracking.mjs';
import { remainingCapacity } from '../src/caps.mjs';
import { seedStoreFromHistory } from '../src/seed-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'test', 'fixtures');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--fixture'));

function supabaseRest() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('OUTREACH_STORE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY');
  const legacy = !process.env.SUPABASE_SECRET_KEY;
  return async (p, init = {}) => {
    const res = await fetch(`${url}/rest/v1/${p}`, { ...init, headers: { apikey: key, 'content-type': 'application/json', ...(legacy ? { authorization: `Bearer ${key}` } : {}), ...(init.headers || {}) } });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(body?.message || `${res.status}`);
    return { body };
  };
}

async function main() {
  const fixture = args.includes('--fixture');
  const env = fixture ? { ...process.env, OUTREACH_SEARCH_PROVIDER: 'fixture', OUTREACH_DATA_DIR: process.env.OUTREACH_DATA_DIR || path.join(here, '..', 'outreach-data', 'fixture') } : process.env;
  const config = loadConfig(env);
  const store = (flag('store') || config.store) === 'supabase' ? new SupabaseStore(supabaseRest()) : new LocalStore(config.dataDir || path.join(here, '..', 'outreach-data'));
  const seed = loadHistory(fixture ? path.join(FIXTURES, 'history') : (config.historyDir || '/workspace/hnw-outreach'));
  const [cmd, sub, id] = positional;
  const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

  if (cmd === 'run') {
    const search = createSearch(config, { fixturePath: path.join(FIXTURES, 'search.json') });
    const fetchPage = createFetcher(config, fixture ? { fixturePages: path.join(FIXTURES, 'pages.json') } : {});
    const llm = createLlm(config);
    const composer = fixture ? (await import('../test/fixtures/fixture-composer.mjs')).fixtureComposer : (llm ? llmComposer(llm) : null);
    return out(await runDaily({ config, store, search, fetchPage, composer, llm: fixture ? null : llm, embed: createEmbedder(config), seed, log: (e, d) => console.error(JSON.stringify({ event: e, ...d })) }));
  }
  if (cmd === 'review') {
    if (sub === 'list' || !sub) return out((await store.listDrafts({ status: flag('status') || 'pending_review' })).map((d) => ({ id: d.id, frame: d.frame, to: d.to_email, name: d.recipient_name, subject: d.subject, status: d.status })));
    if (sub === 'export') return out(reviewMarkdown(await store.listDrafts({ status: flag('status') || 'pending_review' })));
    if (sub === 'show') return out(await store.getDraft(id));
    if (sub === 'approve') return out(await approveDraft(store, id, { by: flag('by'), note: flag('note'), seed, signatureLines: config.signatureLines }));
    if (sub === 'reject') return out(await rejectDraft(store, id, { by: flag('by'), reason: flag('reason') }));
    if (sub === 'edit') {
      const body = flag('body-file') ? fs.readFileSync(flag('body-file'), 'utf8') : undefined;
      return out(await editDraft(store, id, { subject: flag('subject') || undefined, body, seed, signatureLines: config.signatureLines }));
    }
  }
  if (cmd === 'record-send') {
    const draft = await store.getDraft(sub);
    if (!draft) throw new Error(`no draft ${sub}`);
    return out(await recordSend({ store, draft, messageId: flag('message-id'), threadId: flag('thread-id'), sentAt: flag('at') ? new Date(flag('at')) : new Date(), config, confirmedBy: flag('by') }));
  }
  if (cmd === 'record-reply') return out(await recordReply({ store, fromEmail: flag('from'), receivedAt: flag('at') || new Date().toISOString(), messageId: flag('message-id'), snippet: flag('snippet') }));
  if (cmd === 'stats') return out(frameStats({ sends: await store.listSends(), replies: await store.listReplies() }));
  if (cmd === 'caps') return out(remainingCapacity({ sends: await store.listSends({ day: nyDay() }), queued: await store.listDrafts({ status: ['drafted', 'pending_review', 'approved'] }), config }));
  if (cmd === 'seed-history') {
    const dir = fixture ? path.join(FIXTURES, 'history') : (config.historyDir || '/workspace/hnw-outreach');
    const logPath = path.join(dir, 'split-test-log.csv');
    return out(await seedStoreFromHistory({ store, history: seed, logRows: fs.existsSync(logPath) ? parseCsv(fs.readFileSync(logPath, 'utf8')) : [], config }));
  }
  console.log(`usage:
  outreach run [--fixture] [--store local|supabase]      research and queue letters for review (never sends)
  outreach review list|export [--status pending_review]
  outreach review show|approve|reject|edit <id> [--by matthew] [--reason ..] [--subject ..] [--body-file f]
  outreach record-send <id> --message-id <gmail id> [--at ISO] [--by matthew]
  outreach record-reply --from <email> [--at ISO] [--message-id id]
  outreach stats | caps | seed-history`);
}

main().catch((e) => { console.error(JSON.stringify({ error: e.message })); process.exitCode = 1; });
