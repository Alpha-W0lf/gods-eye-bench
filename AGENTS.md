# AGENTS.md

gods-eye-bench measures AI agents that answer questions through God's Eye
View's MCP tools: it replays a recorded snapshot of live feeds through God's
Eye View's own MCP server with the clock stopped, scores each answer exactly,
and rebuilds every published number from committed logs.

## Commands

- Once: `nvm install` (reads `.nvmrc`), `npm ci`, `npm run setup` (clones the pinned God's Eye View
  into `.gev/`; the tests need it).
- `npm run check` runs lint, format and every test, as CI does. Run it
  before each commit; CI also scans the history with gitleaks
  (`npm run scan:secrets` locally).
- One file: `node --test src/score/score.test.mjs`.
- After any change to scoring, runs or the report: `npm run geb -- score`,
  then `npm run geb -- report`, and commit both outputs. A test fails if
  `results/results.json` or the README leaderboard differ from what the logs
  score to.
- `npm run geb -- --help` lists every command. The scripted reference agent
  is free and keyless (the README's demo). Running a model spends quota, so
  it is the maintainer's call. When asked, add `--status community` to
  `geb run`, or `--only <ids> --out <dir>` for a few questions; `geb bench`
  without `--match` writes verified runs and rewrites results and the
  README.
- Adding a question, template, harness or source: [CONTRIBUTING.md](CONTRIBUTING.md).

## Done means

- `npm run check` passes, and `score` and `report` leave the tree unchanged.
- A bug fix carries a test that fails on the old code.
- A change that can move a published number says which numbers moved, in
  the commit and in [docs/reviews.md](docs/reviews.md).
- A fresh reviewer ([`.claude/agents/reviewer.md`](.claude/agents/reviewer.md))
  has tried to break it, and user-visible changes are in the CHANGELOG and
  the docs that own them.

## Read before changing

- **Workflow** (how a change is planned, tested, evaluated and reviewed):
  [docs/workflow.md](docs/workflow.md).
- **Module owners** and data flow: [docs/architecture.md](docs/architecture.md).
  Change a rule where its owner lives.
- **Decisions**: [docs/adr/](docs/adr/). Reversing one is a new ADR.
- **Status and next steps**: [docs/plan.md](docs/plan.md).

## Evidence rules

- Trial logs under `runs/` are evidence, kept as written apart from
  redaction (`redactLocalPaths`, and the Claude Code adapter's `trialLog`).
  A wrong result is corrected by a code fix and a re-run, recorded in
  docs/reviews.md, and a failed trial stays failed.
- The README leaderboard block and `results/results.json` are generated:
  edit `src/report.js` or the runs, and regenerate.
- Ground truth comes only from `src/world/`, independent of the tools under
  test, and the reference agent stays at 100%.
- Changing questions or the prompt (`PROMPT_VERSION` in `src/prompt.js`)
  starts a new set of runs; old and new runs never share a table.
- Held-out questions, their logs and the seed stay on the maintainer's
  machine and out of every prompt; only `heldout.json` aggregates are
  committed ([ADR 0007](docs/adr/0007-held-out-set.md)).
  `.claude/settings.json` denies them and `.env` to Claude Code's file
  tools and simple shell reads (`cat`, `head`); it is a seatbelt, since any
  script, `geb score` included, can still read them.
- Keys live only in the git-ignored `.env`; snapshots record only sources in
  `config/sources.json` ([ADR 0006](docs/adr/0006-data-licensing.md)).
- `.local/`, `snapshots/*/local/`, held-out files and in-progress
  `trials.partial.jsonl` logs are git-ignored on purpose; commit only what
  git tracks by design.
