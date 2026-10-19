# How changes are made

This repository was built AI-native: one maintainer directs coding agents
(mostly Claude Code) and decides scope and anything public, and the agents
work inside the rails below. Each rail leaves evidence in the repository
(tests, ADRs, run logs, the review log), so a reader can check the process
as well as the result. The commands are in [AGENTS.md](../AGENTS.md). The public repository
is a single-commit snapshot of the development history; the
[review log](reviews.md) and [CHANGELOG](../CHANGELOG.md) summarise it.

## 1. Plan

- Planned work is a milestone in [plan.md](plan.md) with an acceptance check
  and the test or run that proves it; done means the proof passed. Fixes
  found in review are recorded in [reviews.md](reviews.md) instead.
- A decision that is hard to reverse, surprising or a real trade-off gets an
  [ADR](adr/): context, choice, alternatives and cost.

## 2. Build test-first

- A change is done when it meets the bar in AGENTS.md ("Done means"),
  starting with a bug fix's test that fails on the old code.
- Rules that must always hold are code: CI rebuilds every public-set number
  from the logs, `geb verify` checks each run's provenance, preflight stops a
  run whose harness reaches outside the replay tools, and a test scans every
  log for paths and credentials.

## 3. Evaluate

The benchmark is itself an eval, so it is held to the standard it applies:

- Ground truth is computed by independent code, a scripted reference agent
  must score 100% through the real tools, and a sample was recomputed by
  hand ([ADR 0003](adr/0003-ground-truth-and-reference-agent.md)).
- Scoring is exact, with no model judge
  ([ADR 0004](adr/0004-structured-answers-exact-scoring.md)).
- A held-out set drawn with a secret seed guards against memorising the
  public questions ([ADR 0007](adr/0007-held-out-set.md)), and how the
  public set was calibrated is in the [technical FAQ](faq.md).
- A change to questions or the prompt starts a new set of runs; a change to
  scoring rescores every run from its logs, and the CHANGELOG and review log
  name the numbers that moved.

## 4. Review adversarially

- Every phase ends with an adversarial review: a self-review in the first
  phases, and since the pre-release review (2026-10-07) fresh reviewers (new
  agent sessions such as
  [`.claude/agents/reviewer.md`](../.claude/agents/reviewer.md)), whose job
  is to break the claims: rerun the numbers from the raw logs, try
  edge cases, mutate code to see a test go red, read every miss.
- Each finding is checked against the code and data before anything
  changes, and a weakness is fixed in code rather than documented. What each
  review caught and changed goes in [reviews.md](reviews.md); a claim the
  data cannot yet prove is labelled Unverified until it can, or left out.
- A failed trial stays failed (AGENTS.md, "Evidence rules").

## 5. Record

- Small commits that say what changed and why.
- User-visible changes go in the [CHANGELOG](../CHANGELOG.md). Each fact
  lives in one file, and the others link to it.
