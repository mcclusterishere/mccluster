# PRIM3 news desk: 24 regional agents read their country's news

Owner, 2026-11-03: "The OVH box should allow each agent to read the news and
make a general statement about what the headline was about as a brief to their
region and comment on every single piece of news in their region, each agent of
24 ... Use the cluster core to get all this shit done."

## What runs where

| Piece | Where |
| --- | --- |
| Agents (24, one per country) | `core/src/prim3/agents.mjs`, copied from the World cast (`data/prim3/world-missions.json`, orders 2–25). McCluster (US) calls missions in and is not a regional agent. |
| News | `media_news_articles` (GDELT GKG, already ingested by Worker `mccluster`), matched by `location_country_fips` |
| Inference | OVH McCluster Core, local model through the Ollama adapter. No paid provider. |
| Job | `prim3_agent_news` (`core/src/executors/prim3-agent-news.mjs`): one agent, at most 8 new headlines in one inference, plus the regional brief every 4 hours |
| Schedule | `mccluster-core-prim3-news.timer`, every 15 minutes, `core/src/seed-prim3-agent-news.mjs` |
| Storage | `prim3_agent_news_comments` (one per agent per article), `prim3_agent_news_briefs`. RLS on, no client policies, kept 7 days. |

Syndicated copies of one story get one reaction. Comments are fiction voiced by
McCluster about real headlines, written only from the headline (the article is
not read), never published to the public feed by this path. Real countries and
real people are never enemies.

## Capacity, honestly

Measured on the box (8 vCPU EPYC-Milan, 24 GB, no GPU, Ollama capped at 6 CPUs,
qwen3 8B Q4_K_M): about 7.7 tokens/s generated, 25 tokens/s prompt, so one
12-headline batch took 86 s (about 7 s a headline).

The 24 countries carry about 8,400 stories a day; the United Kingdom (~2,500)
and India (~1,800) are most of it. Each 15-minute tick has a budget
(`PRIM3_NEWS_DESK_TICK_BUDGET`, default 64 headlines, ~6,100 a day, about half
the box). It is fair-shared: small feeds are covered completely, the remainder
goes to the busiest. On a normal day that is every story in 19 or more of the
24 countries, and the newest stories in the UK and India; every brief still
reads the whole day's headlines. Raise the budget to cover more, at the cost of
the box's other work.

Jobs are kept to one batch because the Core runner is serial: the owner's own
chat waits behind at most one batch (~60 s), never a whole country.

## Box tuning in this change

- **One resident context.** A request with a different `num_ctx` made Ollama
  reload the model (measured ~10 s). Smaller requests now use the resident
  16k context; only larger ones reload.
- **Model stays warm.** `keep_alive` 30m → 24h (`MCCLUSTER_OLLAMA_KEEP_ALIVE`);
  a cold load measured ~8 s.
- **Structured output.** Callers can pass a JSON Schema; the adapter hands it to
  Ollama's `format`, so the 8B model's JSON always parses.
- **Cacheable prompts.** The desk's fixed instructions come first and the agent
  card comes after, so consecutive batches reuse the cached prefix.
- **Threads.** `num_thread` is now settable per request and by
  `MCCLUSTER_OLLAMA_NUM_THREAD`; it stays unset until a benchmark on the box
  shows 6 (matching the 6-CPU quota) beats Ollama's own choice.

Not done here, and why: fine-tuning (training) needs a GPU this box does not
have; a faster or larger model (e.g. a 4B instruct, or a 30B mixture-of-experts)
needs a model pull and a larger service memory cap on the host, which is a
separate host change to propose with measurements.
