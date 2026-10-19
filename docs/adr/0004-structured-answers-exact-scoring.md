# 0004. Structured final answers and exact scoring

**Status:** Accepted, 2026-10-03 (amended the same day for prompt v2)

## Context

Free-text answers need a model judge, which adds cost, bias and its own error.

## Decision

Every prompt asks for a final line
`ANSWER: {"answer": ..., "data_status": "complete" | "stale" | "unavailable"}`.
Answers are typed (integer, number with an absolute or relative tolerance,
string) and scored exactly. The answer is null when the data is unavailable,
or when the data shows that the thing asked about does not exist (prompt v2,
which added that rule for false-premise questions). No model judge in v0.1.

## Consequences

- Scoring is cheap, deterministic and rescorable from logs.
- A model that knows the answer but breaks the format scores zero for that
  trial; format errors are reported separately so this is visible.
- Questions are limited to answers with one checkable form.
- Changing the prompt's wording changes results, so every run records the
  prompt version.
