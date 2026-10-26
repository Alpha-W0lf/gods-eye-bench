# Review: gods-eye-bench TypeScript conversion plan

## 1. Verdict

**Do a smaller form first, not the full conversion in one go.** Move one spawned module and one leaf module to `.ts` as a spike, and widen only if it is clean. Tom's timing call is already made (see the plan's first paragraph; the files given contain no DECISIONS heading), so this review does not reopen it.

- **Case for converting:** the scoring and trial-record shapes are what keep the published numbers honest, and types guard them.
- **Strongest case against:** the repo's value is that its numbers do not move. A full rename touches every file, and the v0.3 list in [docs/plan.md](docs/plan.md) (injection set, held-out set, paired comparisons) is the work that makes the benchmark better.
- **Why not simply "later":** v0.3 will edit `score`, `run` and `report`. Writing that in TypeScript once is cheaper than converting afterwards (Unverified).

## 2. Plan steps checked against the files

**Counts match.** I counted bench_files.txt: 54 `.js`, 17 `.mjs`, 71 files. I did not re-add the 8,663 total. The plan says all checks ran on `main`, yet the checkout was on `readme-gif-timing`. Which tree the counts came from is Unverified.

**Contradiction in the plan: "each commit has `npm run check` green".**

- Step 1 adds `tsc` to `check`, but step 2 renames untyped files under `strict`.
- Unless every file is annotated, `tsc` would fail between the rename and step 3 (Unverified; I haven't seen the code).
- Fix: add `typecheck` to `check` only at the end, or grow `tsconfig` `include` module by module.

**Lint would quietly stop checking.** The eslint config in bench_ci.txt only matches `**/*.js` and `**/*.mjs`. After renaming, `.ts` files would probably fall outside it, and lint would pass while checking nothing (Unverified). The plan leaves the eslint config to step 4 (docs), which is too late. The core `no-unused-vars` rule may also misfire on type-only code (Unverified).

**CI.** CI in bench_ci.txt runs lint, format and test as separate steps, not `npm run check`. Adding `typecheck` to `check` alone changes nothing in CI. The plan does say to edit ci.yml, so it just has to be done.

**Node type stripping.**

- Node on PATH is 22.17.0. `.nvmrc` pins 24.14.0 (per the plan, not installed), and `engines` in package.json requires 24.14 or newer.
- Result (2026-10-26, first step): 24.14.0 loads `src/server.ts` with no flag and no warning; 22.17 fails (unknown extension), and with `--experimental-strip-types` prints an `ExperimentalWarning`. A test in `src/server.test.mjs` requires an empty stderr.
- Run all baselines on the pinned 24.14.0, not the default 22.
- Result: `run.js` does not capture the server's stderr (`connectMcp` ignores it); Claude Code and Cursor spawn it themselves and may surface it, which the empty-stderr test covers.

**Spawn and import paths.** The plan names `src/run.js:86`, `src/server.test.mjs:16`, `src/gev.js:66` and `src/report.js:134`. None of those source files were given, so the line numbers are Unverified.

**`erasableSyntaxOnly` needs a recent TypeScript.** Prettier is pinned exactly in package.json and the other dev dependencies use `^`. Pin `typescript` exactly too (Unverified that this is needed).

**"No committed data names a source file" is the plan's claim, not verified here.** The plan checked one trial log. The CI comment in bench_ci.txt says trial logs are compressed, so a plain search could miss them. An adapter may also record the server launch command, which contains `src/server.js` (Unverified). The plan's docs list leaves out `docs/reviews.md`, `docs/workflow.md`, `docs/adr/`, `.claude/agents/reviewer.md` and `.claude/settings.json`, any of which may name source files (all Unverified). Old ADRs and reviews are history and should not be rewritten.

**Version label.** The plan suggests CHANGELOG "0.3.0?", but [docs/plan.md](docs/plan.md) reserves v0.3 for benchmark work. package.json says 0.2.0.

## 3. Missing from the plan

- A baseline on Node 24.14.0 before any change: the full test count, `geb verify` output, and copies of `results/results.json` and the README leaderboard.
- A before/after test-file count, so the new glob can't silently skip a test.
- A search of decompressed `runs/` for source-file names, not one sample log.
- One commit that only renames, with no content edits, so history and review stay clean.
- A rule to stop and revert if any published byte changes. The merge commit helps, but the plan does not say so.
- A note in the commit and [docs/reviews.md](docs/reviews.md) that no published number moved, as AGENTS.md "Done means" asks.
- A decision on `.mjs` tests: all 17 renamed at once, or per module.
- A check that PR #1 is merged or closed before the fresh worktree starts. The plan states the order but not how to confirm it.

## 4. First S-size step (about one hour, one commit, throwaway)

**Goal:** test the riskiest assumptions: Node on 24.14.0 runs `.ts` unflagged, the spawn path works, and no warning leaks into captured output.

```
git fetch origin
git worktree add ../geb-ts-spike -b spike/ts-server origin/main
cd ../geb-ts-spike
nvm install            # reads .nvmrc (24.14.0)
npm ci && npm run setup
npm run check          # baseline: note the test count
npm run geb -- score && npm run geb -- report
git status --short     # expect empty
```

Then:

```
git mv src/server.js src/server.ts
```

Change the two spawn paths (`src/run.js:86`, `src/server.test.mjs:16`) to `src/server.ts`, plus any import of `server.js` that `grep -rn "server.js" src bin package.json` finds. Do not touch `tsconfig`, eslint or types.

**Proof:**

- `node --test "src/**/*.test.mjs" 2>&1 | grep -ci experimental` is 0, or any warning is confirmed absent from compared output and logs.
- The test count equals the baseline.
- `score` and `report` leave `git status` clean.

**Done:**

- The result (warning or no warning, pass or fail) is written in two lines in the plan's "Unknown" section.
- Leave the spike worktree and branch in place until Tom approves removing them (nothing is deleted without his yes).
- Nothing in the real checkout changes.

---

Drafted by Sonnet 5.5 on the batch API (2026-10-26); claims checked against `bench_ci.txt` (eslint matches only `.js`/`.mjs`; CI notes trial logs are decompressed for the secrets scan). Other Unverified marks stand.
