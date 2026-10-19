# Security

## Reporting

Report a vulnerability privately through GitHub's "Report a vulnerability"
(Security advisories) on this repository. Please do not open a public issue.

Report problems in God's Eye View itself to its maintainers, as its own
`SECURITY.md` describes.

## What this project does

- **Agents get only the replay server's tools.** Claude Code runs with
  `--tools ""` and a strict MCP configuration naming only the replay server.
  Cursor's agent runs with a permission file that denies file reads, shell,
  writes, web fetches and every MCP server the user configured globally;
  Cursor's file search sits outside that permission file, so every call to
  it is logged. The thin runner offers only the replay server's tools. Any
  other tool call, or a tool name the agent made up, is logged as out of
  bounds and fails the trial, so a trial that used one is never scored as
  right.
- **Replay does not fetch.** The replay server answers God's Eye View's
  `fetch` calls from the snapshot and makes any other `fetch` throw. Other
  network APIs are not blocked, so this guards against accidental live
  requests, not against hostile code in God's Eye View's dependencies.
- **Children get a minimal environment.** The harnesses and the replay
  server start with only `HOME`, `PATH`, `USER`, `LOGNAME`, `SHELL`,
  `TMPDIR`, `TERM` and `LANG`. API keys and the held-out seed never reach
  them. God's Eye View is installed with `npm ci --ignore-scripts` at a
  pinned commit.
- **Keys stay with their provider.** The thin runner reads a model's key
  from the `*_API_KEY` variable its entry names (for example
  `GEMINI_API_KEY`), or `GEB_OPENAI_API_KEY` for the endpoint in
  `GEB_OPENAI_BASE_URL`, from the environment or a git-ignored `.env`. A key
  is never sent to another provider, nor over plain http except to this
  machine.
- **No secrets in the repository.** The held-out seed lives in a git-ignored
  `.env` or the macOS Keychain. CI scans the whole history with gitleaks, and
  a test scans every decompressed trial log (which gitleaks cannot read) for
  user paths and credential shapes. Logs record the home and temporary
  folders as `~` and `$TMPDIR` (`HOME` and `TMPDIR` inside folder names),
  and Claude Code logs leave out the account's usage lines.
- **Snapshots hold only redistributable public data**, with no keys or
  personal data. Recorded responses keep only the headers the sources read.
- **Submitted runs are untrusted input.** Their logs are parsed as data and
  rescored; nothing in them is executed. Paths and ids in a run record are
  validated, and decompression is size-bounded.
