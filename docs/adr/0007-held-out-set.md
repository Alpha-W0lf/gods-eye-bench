# 0007. A held-out set from a secret seed

**Status:** Accepted, 2026-10-03; amended 2026-10-07

## Context

A public question set can be memorised, trained against or tuned for.

## Decision

The same templates generate a held-out set from a secret seed
(`GEB_HELDOUT_SEED`), which is never committed. `geb` reads it from the
environment or the git-ignored `.env`, or else from the macOS login Keychain
(service `gods-eye-bench`, account `GEB_HELDOUT_SEED`). Verified runs report
public and held-out accuracy; held-out logs stay out of git, and only
aggregates are published, each naming the checksum of the held-out question
file it was asked, so every published held-out score is tied to one set.

## Consequences

- Only the maintainer produces held-out numbers, and each names the checksum
  of the question set it was asked.
- The seed is a secret like a key: one that reaches a model provider is
  replaced and every held-out run redone. It was replaced once, after a log
  scan caught a harness reading the question file; that harness's file
  reads are now denied, and any such call fails the trial
  ([ADR 0010](0010-out-of-bounds-tools-fail.md)).
- The set guards against memorising the public file, not against tuning to
  the templates: both sets come from the same templates and public
  snapshot, so some held-out answers can be worked out from public code and
  data, and the draw excludes public question ids, not prompts (one prompt
  appears in both, under different scenarios). The redrawn set shares about
  a third of its questions with the first, by expectation. The held-out mix
  has no stale or outage questions and more injected ones, so held-out and
  public accuracy are read side by side rather than as one number. Holding out a separate snapshot
  with the public mix is next on the [roadmap](../plan.md).
