# 0008. Verified and community results, rescored from logs

**Status:** Accepted, 2026-10-03; amended 2026-10-18

## Context

Testing every model should not depend on one maintainer's access to every model, but submitted
numbers must not be taken on trust.

## Decision

Anyone can submit a run directory by pull request under `runs/community/`.
Scores are never submitted: `geb score` recomputes them from the raw logs, and
`geb verify` checks provenance (snapshot and question checksums, God's Eye View
commit, schema). A run the maintainer reproduces moves to `runs/verified/`.
The leaderboard shows the two groups in separate tables.

**Amendment (2026-10-18).** A run stopped part-way (a usage limit or quota)
is kept in `runs/partial/` with the reason it stopped and rescored from its
logs like any other; its summary is in `results/results.json`. It is never
ranked, since its questions are a subset.

## Consequences

A community run can still contain invented transcripts; the table says these
runs are reported, not reproduced.
