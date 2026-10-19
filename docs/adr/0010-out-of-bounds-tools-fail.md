# 0010. A trial that reaches for another tool fails

**Status:** Accepted, 2026-10-03

## Context

The prompt allows only God's Eye View's tools. Harnesses bring their own:
Cursor's agent has file reads, grep, glob and a shell. The log scan before
the first results were committed caught Cursor's agent reading files outside
its workspace, the question file included; those runs were rerun with reads
denied. Denying tools fixes one harness, and the next may bring others, so
the rule belongs in the scorer.

## Decision

A trial that calls any tool other than the replay server's, or a tool name
the agent made up, is scored wrong, whether or not the harness let the call
through. Adapters mark harness tools as out of bounds, the scorer also reads
the replay server's "Unknown tool" answers, and every run reports how many
trials broke the rule.

## Alternatives

- **Penalize only calls that succeeded.** Whether a call could leak anything
  depends on each harness's behaviour, which this repo cannot verify for every
  harness. Rejected.
- **Only report rule-breaking, do not score it.** A leaked answer would then
  count as correct. Rejected.

## Consequences

Agents that explore their environment score lower even when they would have
answered correctly; the prompt tells them not to. The README's legend says
so next to the results.
