#!/usr/bin/env node
/* Demo outreach CLI. Default is draft mode: nothing is sent.
   run                      build letters into state/review-queue.json and print them for review
   sendlist --out <file>    export the eligible letters (verified emails only) as a send list for approval
   send --transport <module> --confirm   gated send: needs DEMO_OUTREACH_MODE=send and DEMO_OUTREACH_SEND_ENABLED=true; max 5
   record-reply --email <e> [--text <t>] [--message-id <id>]   marks replied (and opt out if the text asks)
   opt-out --email <e>      never contact again
   mark-contacted --email <e>   someone already reached by hand
   status                   ledger summary */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { buildLetters, writeQueue, writeSendList, sendRun } from '../src/pipeline.mjs';
import { Ledger } from '../src/ledger.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const flag = (name) => rest.includes(`--${name}`);
const cfg = loadConfig();
if (arg('target')) cfg.target = arg('target');
const ledger = new Ledger(cfg.stateDir);

async function main() {
  switch (cmd) {
    case 'run': {
      const r = buildLetters(cfg, { ledger });
      const file = writeQueue(cfg, r);
      for (const d of r.ready) console.log(`### ${d.name} <${d.email}>\nSource: ${d.source_url}\nSubject: ${d.subject}\n\n${d.body}\n`);
      console.log(`mode=draft target=${r.target.key} queued=${r.ready.length} skipped=${r.skipped.length} queue=${file}`);
      break;
    }
    case 'sendlist': {
      const out = arg('out');
      if (!out) throw new Error('sendlist needs --out <file>');
      const doc = writeSendList(cfg, buildLetters(cfg, { ledger }), path.resolve(out));
      console.log(`wrote ${doc.count} recipients to ${path.resolve(out)} (status ${doc.status})`);
      break;
    }
    case 'send': {
      const mod = arg('transport');
      if (!mod) throw new Error('send needs --transport <module exporting send()>');
      const { send } = await import(pathToFileURL(path.resolve(mod)).href);
      const r = await sendRun(cfg, { transport: send, confirm: flag('confirm'), ledger });
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case 'record-reply': ledger.recordReply(arg('email'), { text: arg('text') || '', messageId: arg('message-id') || null }); console.log('recorded'); break;
    case 'opt-out': ledger.optOut(arg('email')); console.log('opted out'); break;
    case 'mark-contacted': ledger.markContacted(arg('email')); console.log('marked'); break;
    case 'status': {
      const rows = ledger.entries();
      const by = (t) => rows.filter((r) => r.type === t).length;
      console.log(JSON.stringify({ mode: cfg.mode, sendEnabled: cfg.sendEnabled, maxPerRun: cfg.maxPerRun, sent: by('sent'), failed: by('send_failed'), replies: by('reply'), optOuts: by('opt_out') }, null, 2));
      break;
    }
    default:
      console.log('usage: demo-outreach run | sendlist --out <file> | send --transport <module> --confirm | record-reply | opt-out | mark-contacted | status');
      process.exitCode = cmd ? 1 : 0;
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
