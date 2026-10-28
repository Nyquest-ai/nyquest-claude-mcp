# Changelog

## 0.6.0 (2026-10-27)

The API key moves into Claude Code's own plugin configuration, and the shipped code is plain
compiled TypeScript instead of a bundle. Both follow the Claude plugin directory's rules.

### The API key is a plugin option

- The plugin declares one `userConfig` option, `api_key`, marked `sensitive`. Set it with
  `/plugin configure nyquest` in a terminal session, the gear on the plugin's row in VS Code's
  Manage plugins, or `claude plugin configure <id> --values-stdin` from a shell. Claude Code
  stores it with its own login (the macOS Keychain, or its protected credentials file
  elsewhere), hands it to the hooks as `CLAUDE_PLUGIN_OPTION_API_KEY`, and `.mcp.json`
  substitutes it into the MCP server's environment under the same name. Left empty, which is
  the default, the plugin stays in local mode.
- A key saved in `~/.nyquest/config.json` by `configure(apiKey=...)` keeps working and is used
  when the option is empty. When both are set the option wins, and `configure` says so. The
  saved key remains the route where `/plugin` is not available, such as the desktop app.
- **`NYQUEST_API_KEY` is no longer read.** The directory holds a plugin that takes a
  credential already present in the user's environment and sends it to a server, and asks
  for it through `userConfig` instead. Move a key kept there into the plugin configuration.
- Fixed: saving the config wrote the key in effect rather than the one read from the file.
  Any save, including the website's level winning a sync at session start, so copied a
  `NYQUEST_API_KEY` from the environment into `config.json` in plain text (reproduced against
  the 0.5.0 build). Only the file's own key is ever written back now, and a test drives the
  sync path end to end.
- `/nyquest:savings`, `configure`, and the session-start line in local mode say where the key
  in effect comes from, or that it does not start with `nq-v1-`. Never the key itself.
- Checked with Claude Code 2.1.308 in a throwaway configuration: a key saved with
  `claude plugin configure --values-stdin` reached both the SessionStart hook (full mode,
  authenticated against a fake platform) and the MCP server, and its text appeared in no file
  but Claude Code's own credentials file. A fresh install with the option never set connects
  the MCP server with all six tools, in local mode, with no network calls.
- The requirement stays Claude Code 2.1.121: plugin options exist since 2.1.83, and 2.1.119
  fixed MCP servers failing when `${user_config.*}` names an optional option left blank.
- `deploy/` is gone from the repo. It held two one-off scripts from the 0.3.0 platform
  rollout: a smoke test that read `NYQUEST_API_KEY` from the environment and sent it to the
  platform with curl, and a server-side deploy that ran database migrations and restarted the
  service. Neither was part of the plugin, nothing referenced them, and the first is the very
  pattern this release removes from the plugin itself. They remain in the git history.

### Readable shipped code

- `server/dist` is plain `tsc` output, one file per source file with its comments, instead of
  three esbuild bundles. The directory holds code its scan cannot read ("commit readable
  source instead of compiled, packed, or minified code"), and a bundle reads as packed.
  20 files, 108 KB (was 3 files, 132 KB). esbuild is no longer a dev dependency.
- The version is read at runtime from `server/package.json` instead of being injected by the
  bundler.
- The PostToolUse hook costs 3 to 4 ms more per call (median 41 to 45 ms over 25 runs); Node's
  own startup dominates either way.
- CI's drift check also fails on a built file that is not committed.
- 54 tests (was 47).

## 0.5.0 (2026-10-12)

No third-party dependencies, and the retention fix that was staged as 0.4.1.

### The MCP SDK is gone

- `@modelcontextprotocol/sdk` and `zod` are no longer dependencies. The stdio JSON-RPC
  transport is in `server/src/stdio.ts`, about 150 lines. `server/dist/mcp.js` drops from
  785 KiB to 44 KiB, and the plugin now installs with nothing fetched and nothing built.
- Why, in directory terms: a non-image file over 256 KiB is held for a reviewer, code the
  security scan cannot read is held, and every other way of shipping a Node dependency is
  held too, whether that is a committed lockfile install, a package install from a hook
  script, or bundling the package's code in. Removing the dependency removes the finding
  rather than moving it somewhere else.
- Nothing changes for users: the same six tools, same names, same arguments, same output.
  `tools/list` now returns the JSON Schema written out in `mcp.ts` instead of one compiled
  from zod at startup.

### Protocol behaviour, now ours and tested

- Protocol revision: the client's is echoed only when the server supports it, otherwise the
  newest supported one (`2025-11-25`) is answered, as the spec requires. That is also exactly
  what the SDK server did: Claude Code 2.1.295, the desktop app's client, negotiated
  `2025-11-25` with both, connected, and listed all six tools.
- Notifications are never answered, not even to refuse them.
- A bad argument comes back as tool output the model can read, flagged `isError`, rather
  than a protocol error it never sees. An unknown tool or method is a JSON-RPC error, and a
  malformed line is a parse error against id `null`.
- One failing call can no longer take the server down.
- In-flight calls drain before the process exits when stdin closes, so the last reply is
  never lost. The documented smoke test pipes a few frames and closes, and that used to be
  a race.
- The server ends by letting its event loop empty, never by `process.exit()`. On Windows,
  `process.exit()` while `fetch` is still tearing down a TLS socket aborts the process with a
  libuv assertion, and that is exactly the state after a full-mode call to the platform: an
  earlier 0.5.0 build crashed on 6 of 6 exits after `savings`. The replies had already gone
  out, so it showed only in the exit code. A last-resort timer, unref'd, covers a handler
  that never settles.

### Which build a session is running

- The session-start line and the `savings` tool now lead with the version:
  `Nyquest context manager 0.5.0: full mode, ...`. A session started before an update keeps
  its old build until it restarts, and until now nothing inside a session said which one.
- Four protocol tests drive the real server process and require that every line it writes to
  stdout parses as an MCP message. 45 tests in total.

## 0.4.1 (2026-10-02, folded into 0.5.0; never published separately)

Retention fix found by dogfooding 0.4.0 for a fortnight.

### Parked output is now actually deleted after `retentionDays`

- Retention was judged on the session **directory's** mtime, so a session that stayed in use
  never expired anything: every new park refreshed the directory and its oldest payloads
  outlived the promise for as long as the session lived. Only a session left idle for the whole
  window was ever removed. Entries expire individually now, wherever they live, and a session
  directory is removed once its last entry goes.
- A payload whose metadata is missing is swept on its own mtime. 0.3.0 kept one shared
  `index.json`, so entries written by it are left with no metadata once that file goes, and
  nothing would ever reclaim them: they were unreachable by `recall` and invisible to
  retention at the same time.
- A legacy `index.json` is thinned entry by entry and dropped when none of its payloads
  survive, so it can no longer advertise a parked id whose text has been deleted.
- Anything younger than the cutoff is left alone, which keeps a park that is still being
  written (text first, metadata second) safe from the sweep.
- Measured on a real store with `retentionDays: 7` the day this shipped: 200 of 225 payloads
  were past the cutoff, 196 of them unreachable, the oldest 18 days old. The first sweep
  reclaimed 2.2 MB and left exactly the last seven days.
- The session-start line now says `purged N expired`, counting entries rather than sessions.

### Everything else the plugin writes is bounded too

- Per-session savings ledgers in `~/.nyquest/sessions` were never pruned: one file accumulated
  for every session that ever ran, outliving the entries it counted. They are released once a
  session has been idle for `retentionDays`. Idleness rather than age, so a session resumed
  over weeks keeps the counters its own status line reports.
- `hook.log` was append-only with nothing to bound it. It is trimmed to its newest lines when
  it passes 512 KB, cut on a line boundary.

## 0.4.0 (2026-09-16)

Safety, quality and release-hygiene release following the 2026-09-15 readiness audit.

### Full mode: what may leave the machine

- Only prose from web and agent tools (WebFetch, WebSearch, Agent, `digest_url`) is sent to
  the Nyquest platform for condensation. Bash, PowerShell, `digest_file` and MCP output stays
  local unless a tool is opted in with `remoteTools` in `~/.nyquest/config.json` or
  `configure(remoteTool="Bash", remoteEnabled=true)`. `recall(ask=...)` follows the same rule.
- Redaction before upload now covers credentials embedded in URLs, prefixed secret names such
  as `AWS_SECRET_ACCESS_KEY`, `DB_PASSWORD` and `client_secret`, short passwords, Stripe,
  Google and basic-auth tokens, and SAS signatures. Token counts and git SHAs are untouched.
- A condensed digest is labelled a model-written summary. The footer and the parking note
  state what each digest class actually keeps instead of one fixed claim.
- README documents what leaves the machine by mode and tool, links the privacy policy and
  terms, and adds a Support section.

### Parking

- Classifier: lines with two or more `key=value` tokens are structure; equal-shape lines are
  records (data), never prose; prose from a shell needs sentence endings or blank-line breaks;
  a document is code only when at least 30% of its lines sit inside fences.
- Net-saving gate: a park must save at least `minSavingTokens` (default 300, configurable)
  after the digest, the footer and the parking note, and the replacement must be under 70%
  of the original. Replaces the bare-digest 85% check.
- Targeted reads (`grep`, `rg`, `sed -n`, `head`, `tail`, `awk`, `Select-String`,
  `Get-Content -Tail`, anything piped through `head`/`tail`) under 8 KB are never parked.
- The hand-off to Claude Code's own persisted output follows `bashOutputMaxChars` from the
  user's and the project's `settings.json` instead of a fixed 30,000 characters.

### Updates

- The session-start line says when a newer version is available and which command installs
  it. The check is local: the plugin compares its version with the marketplace catalog Claude
  Code keeps on disk. In full mode the platform's settings response may add `latest_version`,
  which covers catalogs that have not been refreshed yet. Claude Code performs the update.

### Robustness

- Store: one metadata file per parked entry; there is no shared index to race on. Sessions
  written by 0.3.0 and earlier are still read and migrate on recall.
- All JSON writes are atomic (temp file plus rename, with retries on Windows sharing
  errors); reads retry transient errors and never mistake a hiccup for an empty file;
  ledger writes can no longer fail a park or a recall.
- One version source: `server/package.json` is injected at build time and checked against
  `.claude-plugin/plugin.json` by `npm run check-version` (also before every build).
- GitHub Actions CI on Ubuntu and Windows (Node 20 and 22) with a check that the committed
  bundle matches the source.
- Documented requirement: Claude Code 2.1.121 or newer.

## 0.3.0 and earlier

See the git history. 0.3.0 (2026-09-13) introduced full mode: platform condensation for
prose, `recall(ask=...)`, `digest_url`, account savings totals, level sync with the website,
and counts-only park reports.
