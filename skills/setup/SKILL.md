---
name: setup
description: Walk the user through turning on Nyquest full mode with a free API key, or show the current mode and level. Use when the user runs /nyquest:setup, asks how to enable full mode, or asks how to set or remove their Nyquest API key.
user-invocable: true
arguments: [key]
---

Goal: get the user into the mode they want with as few steps as possible.

1. Call the Nyquest `savings` tool. Its first line gives the mode, where the key in effect
   comes from (`key from the plugin configuration`, `key from ~/.nyquest/config.json`,
   `no API key`, or that a key does not start with `nq-v1-`), and the level.
2. If the user passed a key as the argument (it starts with `nq-v1-`), call
   `configure(apiKey=<key>)`, which saves it in `~/.nyquest/config.json`, and confirm the
   resulting mode in one line. Add once that `/plugin configure nyquest` keeps a key where
   Claude Code keeps its own login instead of in a plain file. Stop.
3. If the user wants full mode and gave no key, explain in a few short lines:
   - Full mode is free. It adds platform condensation for prose results, `recall(ask=...)`
     answers, and account savings totals. Local mode keeps working without it.
   - What leaves the machine in full mode: prose from web and agent tools (WebFetch,
     WebSearch, Agent, `digest_url`), with secrets redacted, is sent to the Nyquest platform
     and processed by third-party model providers. Bash, PowerShell, file and MCP output never
     leaves the machine unless the user opts a tool in with
     `configure(remoteTool="Bash", remoteEnabled=true)`. Every park also reports counts only
     (tool, class, sizes), never content.
   - Get a key at https://app.nyquest.ai (sign in, create an API key; it starts with `nq-v1-`).
   - Recommended: in a terminal session, run `/plugin configure nyquest` and paste the key
     into the masked field, then restart Claude Code. Claude Code keeps the key where it keeps
     its own login (the macOS Keychain, or its protected credentials file elsewhere) and hands
     it only to this plugin, and the key never enters the chat. In VS Code, the gear on the
     plugin's row in Manage plugins does the same.
   - Where `/plugin` is not available, such as the desktop app: run `/nyquest:setup nq-v1-...`
     or say "set my Nyquest API key to ...". That saves the key in `~/.nyquest/config.json`.
4. If the user wants to leave full mode: when the key comes from the plugin configuration,
   tell them to clear it with `/plugin configure nyquest` and restart; when it comes from
   `~/.nyquest/config.json`, call `configure(apiKey="")` and confirm.
5. If the user mentions a key in the `NYQUEST_API_KEY` environment variable: since 0.6.0 the
   plugin no longer reads it. Point them to step 3 to move the key into the plugin
   configuration.
6. Never print a key back to the user; refer to it as "your key".
