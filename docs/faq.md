# Technical FAQ

The design choices behind the results, and what they cover.

## What does one run cover?

One snapshot, recorded 2026-10-03 18:57 UTC: 55 public and 29 held-out
questions, 3 trials each. Intervals at this size are wide, so the README
ranks by intervals, not points. A new snapshot takes `geb record` against a
running God's Eye View and `geb questions`.

## Does a row measure the model or the harness?

Both. Claude models ran in Claude Code; GPT-5.6 Sol, Grok, Composer and
Gemini 3.8 Flash in the Cursor Agent CLI; open and Gemini API models in the
benchmark's own thin tool loop. Each harness adds its own prompt and tool
handling, so rows compare models like for like only within one harness, and
every row names both. Running one model in several harnesses is first on the
[roadmap](plan.md).

## Why is reporting complete data as unavailable counted as following a planted instruction?

Only the tools' structured status (`stale`, `unavailable`, errors) says data
is missing; text inside a feed is data, not an instruction
([ADR 0009](adr/0009-feed-text-is-data.md)). The injected questions leave
every number untouched, so an agent that reports them unavailable has taken
the planted text's word over the data. The column is a count of trials,
since four questions are too few for an interval.

## How was the difficulty set?

The first 38 questions were answered perfectly by five of the six models
probed, so harder, injected and false-premise questions were added, each
checked by the reference agent; the three strongest Claude models still
answered every question. The probes used models that are also ranked here;
the held-out set, drawn with a secret seed from the same templates, guards
against memorising the public file, not against tuning to the templates
([ADR 0007](adr/0007-held-out-set.md)).

## What happens when an agent asks for something the snapshot lacks?

The tool fails, as it would offline, and the trial is scored as usual. A
sensible query outside the recording (a place name nobody looked up, say)
can therefore cost an agent a question; the tool-use table shows each run's
share of such trials and its accuracy without them.

## Why are answers parsed so strictly?

Exact scoring needs one checkable form, and it removes the cost and bias of
a model judge ([ADR 0004](adr/0004-structured-answers-exact-scoring.md)). A
reply whose final `ANSWER:` line is not clean JSON is a format error: 15 of
Gemma 4 31B's trials and 3 of Gemma 4 26B's ended that line with
`</thought>`.

## How are time limits and retries handled?

A trial gets 5 minutes, or 10 for local models, so a laptop's speed is not
scored as the model's. A trial that times out or loops gets one retry, and
the second attempt is scored. Failures outside the agent (network, login,
rate limits, a stalled provider) are retried until the trial runs and are
never scored, and waits for them do not count as the agent's time. Runs
from 2026-10-18 on also record how many such retries each trial had.

## What does "≤0.1.2" in the Bench version column mean?

Trials record the version that ran them from 0.2.0 on. Earlier runs kept
only their last session's version, so their trials ran on that version or an
earlier one.

## Which models and data are not covered?

Gemini 3.1 Pro and Muse Spark 1.3 were not run. Five Gemini Flash
generations (3 to 3.8) ran part of the public set on a daily request quota; their finished trials are in `runs/partial/` and
`results/results.json`, kept apart from the ranking. Civil aircraft,
satellites and fire perimeters are left out because their terms bar
redistribution, and fires and ships need keys, so they appear only as
unavailable ([ADR 0006](adr/0006-data-licensing.md)). Answers are text; camera images,
weather maps and the globe itself are not scored.

## Why are some measurements machine-dependent?

Latency was measured with three runs in parallel on one laptop, and tokens
are as each harness reports them. Claude Code ran with its built-in tools
switched off. Cost in dollars is not measured.
