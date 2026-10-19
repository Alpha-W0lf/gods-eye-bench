# 0001. Record and replay at the tools' fetch seam

**Status:** Accepted, 2026-10-03

## Context

Agents must see an identical world. God's Eye View's tools read every feed
through an injected `fetchImpl`, and `createLocalMcpServer` accepts one.

## Decision

Record and replay HTTP responses at that seam, and serve them through God's Eye
View's own `createLocalMcpServer` and `serveStdio`, imported from a pinned
checkout. Do not fork, wrap or reimplement the tools.

## Alternatives

- **Proxy the dev server's upstream calls.** Needs the dev server at replay
  time and replays its caches and timers too. Rejected.
- **Record tool results instead of feeds.** Agents can call tools with any
  arguments, so recorded results cover only the calls seen while recording.
  Feeds cover any call. Rejected.
- **Mock data by hand.** Not the real world. Rejected.

## Consequences

- Agents get God's Eye View's exact tool list, descriptions, instructions and
  answers.
- Requests that depend on arguments (geocoding a new place name) can miss the
  snapshot; misses are counted, and questions are written to avoid them.
- Upgrading God's Eye View means re-recording only if its requests change.
