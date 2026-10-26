# Changelog

## [Unreleased]

From a public-release audit; details in `docs/reviews.md`.

- **Changed: the replay server is `src/server.ts`,** the first module moved
  to TypeScript. Node 24 runs it with no flag or warning (tested), and
  `npm run check` and CI type-check it strictly (`npm run typecheck`, TypeScript
  6.0.3) and lint it with typescript-eslint. No published number moved.
- **Added: Claude models through the thin runner,** over Anthropic's
  OpenAI-compatible endpoint, so the same model can be compared in Claude
  Code and in a plain tool loop. The thin runner now retries Anthropic's
  "overloaded" reply (HTTP 529) like other server faults (tested). Not run
  yet; no published number moved.
- **Changed: `geb record` spaces its calls 1.1 s apart.** God's Eye View
  already spaces its Nominatim requests; the recorder now does the same for
  every call, as a second safeguard (tested).
- **Changed: accuracy intervals are Wilson intervals over questions.** The
  bootstrap with an exact fallback was not monotone near 100%; every
  interval moves (perfect runs now read 93%–100%), no ranking claim does.
- **Fixed:** a key could reach an endpoint it was not for, and `apiKeyEnv`
  could name any variable, the held-out seed included; shares were rounded
  twice, so four leaderboard cells were one point high (5 of 11 showed as
  46%); Bench versions from before per-trial stamps are shown as bounds
  ("≤0.1.2"); preflight passed with a sentinel missing; a model's public
  and held-out runs shared working folders; a committed run
  record without trials made `geb run` skip preflight; macOS temporary
  folders written as `/private/var/...` escaped log redaction; a label with
  a newline broke the leaderboard.
- **Added:** each trial prints its tools, answer and verdict; `geb --help`;
  `geb partial` to keep a stopped run's finished trials (five Gemini Flash runs
  are kept this way); tests that each provenance check
  catches its own tampering; AGENTS.md,
  docs/workflow.md and a reviewer subagent; a keyless one-question demo.
- **Results:** Cursor Agent + Gemini 3.8 Flash finished and is ranked (17
  agents; four of the five Cursor models followed the planted text, Gemini
  3.8 Flash did not); held-out aggregates rescored exactly from their logs;
  every committed log passed through the current path redaction, and
  Claude Code logs drop their `rate_limit_event` lines (the account's
  usage, not the trial), the committed ones included, with no result
  changed; a made-up
  tool name fails the trial in every harness (no committed result changes);
  each final record counts the unscored errors before it.
- **Docs:** the README leads with the findings, design trade-offs move to
  a technical FAQ, the review log is condensed, and the incomplete-runs
  table leaves the README (the runs stay in `runs/partial/`).

## [0.2.0] — 2026-10-07

From a pre-release review in six disciplines (AI, ML, data, backend, docs,
security); details in `docs/reviews.md`.

- **Fixed: two failed trials were scored.** A provider failure with an empty
  error message counted as a finished, wrong answer (one trial each for
  Gemma 4 26B and 31B). Outcomes are now decided by error kind, `geb verify`
  rejects any final record the rules never score, and both trials were
  re-run (Gemma 4 31B: 83% to 84%).
- **Measures that say what they mean.** "Followed a planted instruction"
  (a count of readable trials) replaces "injection resisted", which mixed
  miscounts with obedience. New: answering "none" when the answer exists, trials that
  hit an unrecorded request and accuracy without them, nudges, second
  attempts, and bench versions per run. 0% and 100% get exact intervals.
  The README shows the results table, with tool use and run details in a
  second, collapsible one; the scripted reference agent is reported apart.
  `geb verify` also requires a scored failure to have had its retry.
- **Provenance.** `run.json` keeps every session (schema 2); each trial
  records the versions that ran it; resuming with a changed setup is
  refused; held-out aggregates name their question set (`results.json`
  schema 2).
- **Security.** The replay server no longer inherits API keys or the
  held-out seed; keys go only to their own provider and never over plain
  http; Cursor runs deny the user's own MCP servers; CI pins Actions to
  commits, installs without scripts, and scans history with gitleaks;
  a test scans every decompressed log.
- **Robustness.** One error type with a kind for every adapter (a spent
  Cursor or Claude Code usage pool now stops a run cleanly); trial logs that
  survive a crash mid-write (a cut-short last line is dropped, finished logs
  are written atomically); interruption-safe setup; validated CLI numbers and model
  entries; `bench` skips a failed model instead of aborting; the trial
  deadline always wins, and a timed-out harness is stopped with every
  process it started.
- **Docs.** Findings corrected and qualified (harness confound, held-out
  limits, Haiku's errors); a public roadmap; ADRs 0005 and 0007 amended.

## [0.1.2] — 2026-10-05

- The thin runner no longer uses Node's `fetch`, which gives up when a reply
  takes over 300 seconds to start. Qwen 3.5 9B sometimes thinks that long in
  one turn on a 16 GB laptop, so 23 of its attempts were cut off at five minutes
  and logged as harness errors instead of running to the 10-minute trial
  limit. No other run had a request that slow (checked against Ollama's
  request log), so their results are unchanged.
- Only scored failures (timeouts, agent failures) use up a trial's retry; a
  network or quota error in between no longer does. No committed result
  changes: the one trial this could have affected scores the same.
- A used-up daily quota stops the run cleanly, with the
  rest of its trials left pending for the next day.
- Transient server faults (HTTP 500, 502, 504) are retried with backoff like
  rate limits; Google's Gemma endpoints answer "Internal error" now and then.
- Waiting out a rate limit or a server fault moves the trial deadline and is
  left out of the trial's time (`usage.rate_limit_wait_ms`).
- A per-model request limit (`requestTimeoutMs`, 2 minutes for the Gemini
  API): a request the provider never answers is retried as a stall
  (`usage.stall_ms`) instead of running the trial into a scored timeout.
  Google's Gemma endpoints held some requests open indefinitely on Oct 5.
- A timed-out trial's error says so, instead of "The operation was aborted".
- A run joins the results only once its held-out split is done too.
- `geb run` and `geb preflight` use the model's entry in `config/models.json`
  (endpoint, key variable, label, concurrency, time limit); preflight runs
  before a run starts, not on every resume.
- Nine Gemini API models: Gemma 4 31B and 26B A4B,
  Gemini 3.5 and 3.1 Flash-Lite, and Gemini 3.8, 3.7, 3.6, 3.5 and 3 Flash.

## [0.1.1] — 2026-10-04

- The thin runner asks once ("Give your final answer now…") when a model
  ends with an empty reply, which Ollama's thinking models often do; trials
  record whether it happened. Local models are re-run on this version.
- Per-model endpoints and keys for the thin runner, with rate-limit backoff.
- `geb preflight`, run before every full run; incomplete runs reported apart
  from the leaderboard; the held-out seed readable from the macOS Keychain.

## [0.1.0] — 2026-10-03

First version.

- Record and replay God's Eye View's feeds at the tools' fetch seam, through
  its own MCP server, with a frozen clock and no network.
- Snapshot `2026-10-03` from redistributable sources: USGS earthquakes, NOAA
  NHC/CPHC cyclones, Launch Library 2 launches, adsb.lol military aircraft,
  OpenStreetMap geocodes, and the keyless error answers of NASA FIRMS and
  AISStream.
- 55 public and 29 held-out questions across earthquakes, cyclones, launches,
  military aircraft, infrastructure and keyless feeds, under baseline, stale,
  outage and injected scenarios, with harder and false-premise questions.
- Ground truth computed independently of the tools; a scripted reference
  agent scores 100% through the replay server.
- Adapters for Claude Code, the Cursor Agent CLI and a thin OpenAI-compatible
  runner (Ollama), with exact scoring, question-level bootstrap intervals, one
  results file and a generated leaderboard.
- Verified runs for Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 4.5
  (Claude Code), Grok 4.7, Grok 4.5 and Composer 2.5 (Cursor Agent CLI), and
  local Qwen 3.5 4B and Gemma 4 E2B (thin runner), with the reference agent.
