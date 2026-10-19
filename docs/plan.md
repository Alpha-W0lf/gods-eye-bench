# Plan and roadmap

Milestones in build order. Each is done only when its acceptance check passes
and its evidence (a test, a recorded run or an entry in `docs/reviews.md`)
is in the repository. Status is updated in place.

| #   | Milestone                   | Acceptance                                                                                                                                                            | Proven by                                          | Status |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------ |
| M0  | Repo skeleton               | `npm test`, `npm run lint`, `npm run format:check` pass; CI green on GitHub                                                                                           | CI runs on every push                              | Done   |
| M1  | Pinned God's Eye View       | `geb setup` clones the pinned commit and installs it; `src/gev.js` refuses a checkout at another commit                                                               | `gev.test.mjs`; CI's setup step                    | Done   |
| M2  | Snapshot store and replay   | Keys normalise; snapshots round-trip; checksums catch edits; replay serves entries, 404s misses, blocks the network; scenarios overlay correctly; the clock is frozen | `snapshot/*.test.mjs`                              | Done   |
| M3  | Replay MCP server           | Speaks MCP over stdio with God's Eye View's tool list; writes a trace line per tool call; identical output across runs                                                | `server.test.mjs`                                  | Done   |
| M4  | First recording             | `geb record` writes a snapshot with only allowed sources, notices per source, and no secrets                                                                          | `snapshots/2026-10-03`; gitleaks clean             | Done   |
| M5  | World parsers and questions | Each template's truth is unit-tested; `geb questions` regenerates the committed public set byte for byte                                                              | `world/*.test.mjs`, `questions/*.test.mjs` (CI)    | Done   |
| M6  | Scorer and statistics       | Answer parsing, scoring rules and the interval are tested, including malformed answers                                                                                | `score/*.test.mjs`                                 | Done   |
| M7  | Reference agent             | Scores 100% on every public question through the replay server                                                                                                        | `run.test.mjs` (CI); held-out 100% locally         | Done   |
| M8  | Harness adapters            | `claude-code`, `cursor-agent` and `openai-compatible` each complete questions end to end; out-of-bounds tool use is recorded                                          | Smoke runs (reviews, phase 5); `adapters.test.mjs` | Done   |
| M9  | Results and report          | `geb score` rebuilds `results/results.json` from logs; `geb report` regenerates the README leaderboard; CI fails if either is out of date                             | `results.test.mjs` (CI)                            | Done   |
| M10 | Benchmark runs              | ≥3 Claude and ≥3 non-Claude models, 3 trials each, public and held-out; every result names harness and model                                                          | `runs/verified/*`, `results/results.json`          | Done   |
| M11 | Public polish               | README (independence first line), LICENSE, CONTRIBUTING, SECURITY, CHANGELOG, globe screenshot; docs accurate                                                         | Review in `docs/reviews.md`                        | Done   |
| M12 | Release review              | Six reviews, one per discipline (AI, ML, data, backend, docs, security); every must-fix finding fixed or disclosed                                                    | `docs/reviews.md`                                  | Done   |

## Next (v0.3)

What the results and reviews so far point to, in order:

1. **Separate harness from model on the planted-instruction result.** Run
   Claude Sonnet 5.5 inside Cursor, and Claude models through the thin
   runner, so the same model is measured in several harnesses.
2. **A stronger injection set.** More injected questions, several notice
   texts, and a paired baseline for each, so the obedience rate has a usable
   interval.
3. **A held-out set that tests generalisation.** Hold out a second snapshot
   or time window and match the public mix of scenarios, instead of drawing
   both sets from one snapshot's templates.
4. **Fewer unrecorded requests.** Record the place names and areas agents ask
   for most, and answer an unrecorded request with a clear "not in the
   recorded world" message rather than a tool failure.
5. **Finish the five Gemini Flash generations** (3 to 3.8), which run on a
   daily request quota.
6. **Paired comparisons** between adjacent rows, instead of reading
   overlapping intervals.
7. **Score errors the agent causes** (an overlong context) as the agent's,
   where a harness reports them as its own.
