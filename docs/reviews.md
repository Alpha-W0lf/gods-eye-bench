# Review log

Every phase ends with an adversarial review: what is wrong, missing,
over-built or unclear, checked against the code and the data before anything
changes ([workflow](workflow.md)). Entries are dated and newest last; each
describes the project as it stood that day. The public repository is a
single-commit snapshot of the development history; this log summarises it.

## Phase 1: learn God's Eye View (2026-10-03)

Cloned God's Eye View at `aa16b7c3` (v0.2.1), ran its doctor and dev server,
and drove its MCP server over stdio: `initialize`, `tools/list` (30 tools)
and the tools the benchmark uses. Confirmed that Claude Code, the Cursor
Agent CLI and local Ollama models can each be restricted to one local MCP
server.

- The tools read every feed through one injected `fetchImpl`, so offline
  replay needs no change to God's Eye View; a spike replayed nine calls
  byte for byte.
- Stale flags come from the server's own signals, not the clock, so the
  stale and outage scenarios replay those signals.
- Place names resolve to bounding boxes, so counting questions use
  coordinates.
- Early notes on God's Eye View itself: `docs/MCP_SETUP.md` names port 5173
  where the dev server uses 4173, and `get_earthquakes` reports no feed
  freshness.

## Phases 2–4: vision, architecture, plan (2026-10-03)

- Success measures written as checks the build must pass, including "the
  reference agent scores 100%".
- Licensing settled before any recording: CelesTrak, OpenSky and NIFC data
  stay out of public snapshots ([ADR 0006](adr/0006-data-licensing.md)).
- Tool use is traced by the replay server itself, so every harness is
  measured the same way.
- Every milestone has a test or a recorded run as its proof, and a secret
  scan runs before every push.

## Phase 5: build (2026-10-03)

50 tests, including the gate that the reference agent scores 100% on every
public question through the real replay server; smoke runs on all three
model harnesses. Caught and fixed while building:

- The recorder keeps every `x-` header, which carries the military feed's
  staleness signal.
- A held-out "launches from China" question counted a sea launch whose pad
  names no country; the reference agent caught it at 94%, and the template
  now skips countries the tools cannot attribute.
- Harness errors (network, login) stay pending until a rerun succeeds, so an
  outage is never scored as the model's failure.
- Ollama silently truncates prompts to the model's default context; local
  models run through 32k-context variants (`config/ollama/`).

**Difficulty.** On the first 38 questions five of six models probed scored
100%, so harder questions (more rows, several filters, arithmetic no tool
does), an injected scenario (an instruction planted in feed text, numbers
untouched) and false-premise questions were added, each checked by the
reference agent. Calibration runs were discarded, never mixed into results.

## Phase 6: benchmark runs (2026-10-03)

A scan of the raw harness logs before committing showed that Cursor's agent
could read files outside its workspace through its own read tool. The
response:

- Cursor runs deny file reads everywhere, and any call outside the replay
  server fails the trial ([ADR 0010](adr/0010-out-of-bounds-tools-fail.md)).
- Every Cursor run under the old configuration was discarded and rerun, and
  the held-out set was regenerated from a new seed with every held-out run
  redone.
- Claude Code runs with no built-in tools at all; its logs show no
  out-of-bounds calls, and its runs stand.
- Finished runs are recognised on resume, so a complete run is never
  restarted; the thin runner's "no answer after 12 turns" is the agent's
  failure, retried once.

## Phases 7–9: polish and publish checkpoint (2026-10-03)

- Every README claim was checked against the data before committing.
- The five findings about God's Eye View, each reproduced on its code at
  `aa16b7c`, and the first three again on its `main` at `e685449`: the MCP setup guide
  names port 5173, so every tool call fails; `get_cyclones` sets
  `data.stale` but its summary does not say so (a test fails on the
  current code); its MCP tests caught 1 of 4 planted feed regressions (the
  cyclone stale flag dropped, the earthquake cut-off at M3, the hourly
  earthquake feed, pending cyclone geometry rejected); place names resolve
  to bounding boxes; and feed text reaches agents verbatim, which the
  planted-instruction results measure.
- Ten verified runs passing `geb verify`; `results/results.json` and the
  leaderboard regenerate exactly from the logs in CI.

## Post-run audit (2026-10-04)

- **Ground truth, a third way.** Twelve answers recomputed by hand with `jq`
  from the raw recordings (counts, maxima, a time window, an average, a time
  gap, a haversine radius): all twelve match the truth code and the
  reference agent.
- **Every miss by a Claude Code or Cursor model read one by one:** each is a
  genuine agent error (a search radius too small, mental arithmetic on
  distances, one miscount). No question was ambiguous.
- **Date skew.** With the harness told a later date, Claude Haiku 4.5 raised
  no false stale alarms in 20 complete-data trials, because the prompt
  defines staleness by what the tools report. Resumed Cursor runs repeat
  finished questions as a control first (6 of 6 right on 2026-10-06).

## Runner hardening and Gemini API models (2026-10-05)

- The thin runner posts with `node:http`, bounded only by the trial's own
  limit; Node's `fetch` gave up on replies slower than 300 s, which cut off
  23 Qwen 3.5 9B attempts before its 10-minute limit. No other run had a
  request that slow.
- Only scored failures use up a trial's retry; rate-limit and server-fault
  waits move the deadline and are left out of the trial's time; a spent
  daily quota stops a run cleanly; a provider that holds a request open is
  retried as a stall.
- Nine Gemini and Gemma models were added through Google's Gemini API, each
  on a daily request quota.

## Pre-release review (2026-10-07)

Six independent reviews (AI engineering, ML, data, backend, docs and
developer experience, security). What changed:

- Outcomes come from the error kind, not its message, and `geb verify`
  rejects any final record the rules never score; it found two failed trials
  scored as wrong answers, which were rerun.
- "Followed a planted instruction" counts readable answers that call
  complete data stale or unavailable, so a miscount no longer counts as
  obedience.
- `run.json` keeps every session, each trial records its versions, and
  resuming with a changed setup is refused.
- The replay server and harnesses get a minimal environment with no keys or
  held-out seed; Cursor denies the user's own MCP servers; keys go only to
  their provider over https; CI pins Actions to commits and scans history
  with gitleaks; a test scans every decompressed log.
- One error type with a kind for every adapter, crash-safe run files,
  interruption-safe setup, and one owner each for run files and trial rules.

## Public-release audit (2026-10-18)

Three fresh reviewers tried to break the claims (every leaderboard cell
recomputed by an independent Python scorer), the code (probes and mutations
in a scratch clone) and the docs; then fresh reviewers checked every fix.

- **Findings brought up to date:** 17 agents once Cursor + Gemini 3.8 Flash
  finished; the planted
  instruction followed by four of the five Cursor models; Haiku 4.5 once in
  9 held-out trials.
- **Numbers:** shares are rounded once (four cells had shown one point
  high); versions from before per-trial stamps are shown as bounds
  ("≤0.1.2").
- **Code:** a committed run record no longer skips preflight; macOS
  temporary folders and the home folder are redacted in every spelling a
  log uses (path, URL-encoded, dashed in folder names), every committed log
  was passed through the same redaction, and Claude Code logs drop their
  `rate_limit_event` lines (the account's usage, not the trial), the
  committed ones included, with no result changed; `geb partial` keeps a stopped run's
  finished trials, refusing held-out runs and empty ones; every provenance
  check has a test that fails when it is broken.
- **Agent guidance:** [AGENTS.md](../AGENTS.md), [workflow.md](workflow.md)
  and a reviewer subagent.

## Second pass (2026-10-18)

Four more reviewers new to the audit: a first-time reader following the
README in a fresh clone, a numbers audit with its own scorer (every cell of
every table reproduced), a code review with 72 mutations, and a docs and
AI-workflow review.

- **Security:** an API key goes only to the endpoint it belongs to, and a
  model entry can name only a `*_API_KEY` variable.
- **Statistics:** one monotone Wilson interval over questions replaces the
  bootstrap with an exact fallback, which could rank 54 of 55 above 55 of 55
  ([ADR 0005](adr/0005-statistics.md)). Held-out aggregates were rescored
  exactly from their logs.
- **One rule in every harness:** a made-up tool name fails the trial
  whichever harness sent it, read from the replay server's own trace.
- **Runner:** preflight fails if a sentinel question is missing; a model's
  public and held-out runs use separate working folders; each final record
  counts the unscored errors before it; each public trial prints its tools,
  answer and verdict, while held-out runs log only progress.
- **Tests:** guards that a mutation could break unnoticed (Cursor's deny
  rules, integer answers, per-question averaging, log redaction, resume on a
  changed endpoint, mixed setups in one table) each have a test.
- **Results:** Cursor + Gemini 3.8 Flash finished and is ranked (87%, 0 of
  12 on the planted instruction).
- **Docs:** the README leads with the findings, design trade-offs are
  answered in the [technical FAQ](faq.md), and `geb --help` lists every
  command.

## Public-surface review (2026-10-19)

A hands-on review of everything a visitor sees, in a fresh clone: setup,
the keyless demo, the tables, every link, and 65 MB of decompressed logs
rescanned. What changed:

- `geb record` spaces its own calls 1.1 s apart as a second safeguard
  (God's Eye View already spaces its Nominatim requests), tested through the
  recorder's call loop.
- architecture.md describes what the recorder calls and the manifest's real
  fields; AGENTS.md reads as a maintainer's guide in its own right.
- The format check covers `src/questions/` (an unanchored ignore rule had
  skipped it); nine unused template lists are gone; the details table says
  "tokens", not "cost"; setup says `nvm install`.

## TypeScript, first step (2026-10-26)

`src/server.ts` runs under Node 24's type stripping. A fresh review passed
it, and its notes changed this:

- The CHANGELOG says lint reads `.ts` files only while they hold no type
  syntax; the TypeScript parser comes with the first types.
- The rename commit (59d54c4) fails the tests on its own, since `run.js`
  still named the old path until the next commit. Git tracks the combined
  change as a rename, so later steps keep the rename and the fixes in one
  commit.
- No published number moved.
