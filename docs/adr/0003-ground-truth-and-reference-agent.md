# 0003. Independent ground truth, checked by a reference agent

**Status:** Accepted, 2026-10-03

## Context

If the tools under test computed the expected answers, a tool bug would be
scored as correct.

## Decision

`src/world/` parses the raw recorded responses with its own code, and each
template computes its truth from those records. A scripted `reference` agent
answers every question through the real replay server and must score 100%.
A mismatch is investigated as a bug in the template, the truth code or God's
Eye View.

## Consequences

- Two independent paths must agree before a question ships.
- Truth code documents what each question means precisely (for example,
  great-circle distance, magnitude at least 2.5).
- Disagreements found this way are candidate upstream issues.
