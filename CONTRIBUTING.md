# Contributing

Thanks for helping. Three kinds of contribution are most useful: a new
harness adapter, results for a model, and better questions.

## Set up

```bash
nvm install && npm ci && npm run setup && npm run check
```

`npm run check` runs ESLint, Prettier and the test suite, which is what CI
runs. Code style follows God's Eye View, so pieces can move upstream: ES
modules, 2-space indent, single quotes, semicolons, JSDoc on exported
functions, `*.test.mjs` beside the code with `node:test`.

## Add a harness

Add one file to `src/adapters/` and register it in `src/adapters/index.js`,
which documents the contract. Your adapter starts the harness with the replay
server as its only MCP server, returns the final reply, usage and the
harness's own tool calls, and marks any tool that is not the replay server's
as out of bounds. Add a test for your log parser on a recorded sample.

## Submit results

1. Run the public set with your adapter and model, marked as community:

   ```bash
   npm run geb -- run --adapter <adapter> --model <model> --label "<Harness> + <Model>" --status community
   ```

2. Check provenance and rescore:

   ```bash
   npm run geb -- verify
   ```

   ```bash
   npm run geb -- score
   ```

   ```bash
   npm run geb -- report
   ```

3. Open a pull request with `runs/community/<run-id>/`, `results/results.json`
   and the README. Say which harness version and settings you used.

Scores are never taken from a submission: CI rescores your logs. The
leaderboard lists community runs separately until the maintainer reproduces
them.

## Change questions or the snapshot

Questions come from templates in `src/questions/templates/`; their truth is
computed by `src/world/`, never by the tools under test. A new template needs
tests for its truth, and the reference agent must still score 100%
(`npm test` checks it). Regenerate the question file with
`npm run geb -- questions` and commit it. Changing questions or the prompt
invalidates existing runs, so say so in the pull request.

A new snapshot needs a running God's Eye View dev server at the pinned commit
and `npm run geb -- record <id>`. Only sources in `config/sources.json` are
stored; add a source there only with its license checked and its terms
linked.

## Commits

Small commits with clear messages; conventional prefixes (`feat:`, `fix:`,
`docs:`, `test:`) are welcome. Run `npm run scan:secrets` (gitleaks) before
pushing.
