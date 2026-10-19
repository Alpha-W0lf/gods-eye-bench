# Vision

## The problem

God's Eye View gives AI agents tools for the live world: earthquakes, storms,
launches, aircraft, satellites, infrastructure and more, over the Model
Context Protocol (MCP). Its tools have unit tests. Nothing yet measures what
matters to the person asking: **does the agent come back with the right
answer, and does it say so honestly when the data is missing or old?**

That is hard to measure because the world keeps changing. Two agents asked
the same question an hour apart see different data, so their scores cannot
be compared, and nobody can check either answer later.

## What this is

`gods-eye-bench` is an independent benchmark for agents that use God's Eye
View's tools. It freezes the world: it records the feeds the tools read into a
versioned snapshot, then replays that snapshot through God's Eye View's own MCP
server, offline, with the clock stopped at the moment of recording. Every agent
sees the identical world. Code computes the correct answer to each question
from the same snapshot, independently of the tools under test, and a scorer
checks each answer exactly.

## Who it serves

- **God's Eye View maintainers:** evidence of how agents use the tools, which
  descriptions confuse them, and where results hide stale or missing data.
  Deterministic replay also makes the tools themselves testable on real data.
- **Agent builders:** a fair, repeatable test of a model plus harness on
  live-world tool use, with one file to add their own.
- **Evaluators:** results with uncertainty, raw logs and full provenance, so a
  number can be checked rather than trusted.
- **Engineers reading this repo:** a worked example of evaluation design,
  deterministic record and replay, and honest statistics.

## What good looks like

- An agent's score depends on the agent, not on when it ran.
- Every number in the leaderboard can be traced to a snapshot checksum, a God's
  Eye View commit, a harness version, a model, and the raw logs of every trial.
- The scorer and the ground truth are tested, and a scripted reference agent
  scores 100% through the real tools; any gap is a bug in the benchmark or in
  the tools, and gets reported.
- Results name the harness as well as the model, and say plainly that harnesses
  differ.
- Adding a model takes a config entry; an agent framework or MCP client
  takes one adapter file.

## Success measures (v0.1)

1. One command reproduces a run from committed snapshots, without touching
   the live data feeds.
2. At least 3 Claude models and 3 non-Claude models, each with repeated trials,
   reported with 95% confidence intervals.
3. The reference agent scores 100% in CI on frozen fixtures.
4. Measures beyond accuracy: honesty about unavailable and stale data,
   fabrication, tool-use efficiency, latency and tokens.
5. A held-out question set that is never published, so the public set cannot be
   trained against without it showing.
6. Findings about God's Eye View itself, each reproduced on its own code.

## Non-goals

- **Not a general agent benchmark.** It measures God's Eye View tool use only.
- **Not a pure model comparison.** Harnesses add their own prompts and tool
  handling, so only models in the same harness compare like for like.
- **Not live monitoring.** It does not test whether the feeds are up today.
- **Not images or the globe.** It scores text and structured answers;
  questions that need camera images, weather maps or satellite imagery are out.
- **Not official.** It is not affiliated with or endorsed by God's Eye View or
  Halfpixel.
