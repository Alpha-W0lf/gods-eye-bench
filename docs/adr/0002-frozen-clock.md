# 0002. Freeze the clock in the replay process

**Status:** Accepted, 2026-10-03

## Context

Some tools use the current time: satellite passes, the 30-day launch window,
freshness labels. Replaying at a later time would change answers.

## Decision

Before importing God's Eye View, the replay server replaces `Date` with a
subclass whose `now()` and argument-less constructor return the snapshot's
`clock_ms`. Timers are untouched.

## Alternatives

- **Inject a clock service.** Cleaner, and the space tools already read
  `services.clock`, but most time-dependent code does not, and it would mean
  changing God's Eye View.
- **A clock that runs from the snapshot time.** Answers would drift by the
  seconds a trial takes. Rejected.

## Consequences

Deterministic answers, verified by replaying the same calls repeatedly with
byte-identical output. The patch is confined to the replay process.
