# 0005. Uncertainty from a question-level interval

**Status:** Accepted, 2026-10-03; amended 2026-10-07 and 2026-10-18

## Context

Each question runs several times per model. Trials of one question are
correlated, so treating every trial as independent overstates confidence.

## Decision

Accuracy is the mean over questions of the per-question mean over trials. The
95% interval is a Wilson score interval with the questions as the sample. A
question's score lies in [0, 1], so its variance is at most p(1 - p): the
interval does not understate the spread of fractional scores. Measures over very few
questions (how often an agent followed a planted instruction: 4 questions)
are too small for an interval and are reported as counts of trials.

**History.** Until 2026-10-18 the interval was a percentile bootstrap over
questions (2,000 resamples, fixed seed), with the exact Clopper-Pearson
interval when a run scored 0% or 100% (amended 2026-10-07, after a review
flagged "100% (100%–100%)"). Reviews then showed the mix was not monotone:
54 perfect questions and one at 2/3 got a lower bound of 98.2%, above a
perfect run's 93.5%, and equal fractional scores got a zero-width interval.
No published ranking was inverted. The Wilson interval is one method across
the range, needs only the mean and the question count (so held-out
aggregates get it without their logs), and has no random seed.

## Consequences

- Intervals are monotone in the score and reproducible without randomness.
  Wilson's coverage is close to, not exactly, 95% at these sizes.
- With 55 questions they are wide (55 of 55 gives 93.5% to 100%), and the
  README says so instead of ranking runs whose intervals overlap. Three runs
  at 100% cannot be ordered.
- Small subsets (4 injected questions, 7 fault questions) are too small to
  rank on.
- `results.json` also records the share of questions answered correctly in
  every trial; the README tables leave it out.
- Overlapping intervals are a conservative reading. A paired comparison over
  the shared questions would be sharper; it is on the roadmap.
