# Fields and behaviors used by `medium.json`

Draft only. Written 2026-11-15 against the Kiro docs as fetched that day. The user's CLI version (expected 3.3.0) is **not verified**. `medium.json` uses the CLI V3 schema; the older 2.x fields `toolsSettings` and `allowedTools` are not used (see the first section).

Status: **confirmed** = stated on the cited page on the fetch date; **to verify** = not stated, or only stated by an unofficial source, or depends on runtime behavior. JSON cannot carry comments, so this file is the place for the caveats.

Doc pages (all fetched 2026-11-15):

- [A] https://kiro.dev/docs/custom-agents/configuration-reference/ (the old `/docs/cli/custom-agents/configuration-reference/` redirects here)
- [B] https://kiro.dev/docs/custom-agents/creating/
- [C] https://kiro.dev/docs/hooks/
- [D] https://kiro.dev/docs/hooks/types/
- [E] https://kiro.dev/docs/hooks/actions/
- [F] https://kiro.dev/docs/cli/headless/
- [G] https://kiro.dev/docs/tools/
- [H] https://kiro.dev/docs/permissions/
- [I] https://kiro.dev/docs/reference/cli-commands/
- [M] https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- [U] https://github.com/dev-rb-hub/rendu.ai/blob/main/docs/reference/kiro-cli/hooks.md (third party, unofficial; a copy of the docs plus local notes)

## Requested mechanisms that the docs say do not apply to CLI V3

| Requested | What the docs say | What `medium.json` does |
|---|---|---|
| `toolsSettings` (fs_write allowed paths) | [A]: CLI V3 ignores `toolsSettings`; a 2.x JSON profile with it and no `permissions` block is skipped by V3 until `/upgrade-agent` converts it. The replacement is `permissions.rules` with `capability: fs_write`. | Uses `permissions.rules`. A path restriction for writes **exists** (glob `match` on `fs_write`). The hook is a second layer. |
| `allowedTools` | [A]: CLI 2.x legacy; V3 skips a profile that has it without `permissions`. | Not used. Pre-approval is done with `permissions.rules` (`allow`). |
| `toolAliases`, `keyboardShortcut` | [A]: not part of the V3 schema. | Not used. |
| Hook object form (`agentSpawn`, `preToolUse` camelCase keys) | [A]: 2.x shape; V3 still reads it as compatibility input. Current form is an array with PascalCase `trigger`. | Uses the array form with `"trigger": "PreToolUse"`. |

## Fields in `medium.json`

| Field / behavior | Value used | Status |
|---|---|---|
| File location (project level) | Final home would be `.kiro/agents/medium.json`; the draft lives in `spikes/kiro-agent/` and the README copies it | confirmed: [B] `.kiro/agents/` in the workspace, `~/.kiro/agents/` global; local wins on a name clash with a warning |
| File name rule | `medium.json` (file name = agent name) | confirmed: [B] "the filename becomes the agent name"; [A] `name` is optional and derived from the filename |
| Agent file can be JSON | JSON | confirmed: [A] JSON or Markdown with YAML front matter |
| `name` | `"medium"` | confirmed: [A] |
| `description` | text | confirmed: [A] |
| `prompt` | inline string | confirmed: [A] inline text or `file://` (relative to the agent file's directory) |
| `resources` | `file://.kiro/steering/necromancy-laws.md`, `file://.kiro/steering/honesty.md` | confirmed: [A] `file://` paths, globs allowed, loaded into context at startup (limits: 32 files, 100,000 characters, CLI 3.1.0+). **to verify:** that a relative `file://` path in `resources` resolves against the workspace root (and not against the agent file's directory) when the agent file sits in `.kiro/agents/`. The `prompt` example in [A] is relative to the agent file; the `resources` examples (`file://README.md`) read as workspace-relative. Check in the transcript that both steering files were loaded. |
| Inherited default steering | Not disabled | confirmed: [A] custom agents also inherit default steering/skills/AGENTS.md unless `chat.disableInheritingDefaultResources` is true. Effect here: the other `.kiro/steering/*.md` files may also load. Not a security issue; costs context. |
| `tools` | `read_file`, `list_directory`, `fs_write`, `fs_append`, `str_replace`, `@mediumstub/get_certificate` | confirmed: [A] built-ins by name, `@server/tool` for one MCP tool; [G] tool IDs. **to verify:** that direct tool IDs (not only tags `read`/`write`) are accepted in `tools`. [A] says built-ins "such as knowledge are selected by direct tool ID" and shows `read_file`-style names in [F] `--trust-tools`; the `tools` examples only show tags. |
| `tools` excludes shell, web, sub-agent | not listed; also `excludedTools` below | confirmed: [A] `tools` decides what the agent can see |
| `excludedTools` | `["shell","web","subagent","invoke_sub_agent","delete_file"]` | confirmed: [A] new in V3, excludes tools even when `tools` allows them; categories `shell`, `web`, `subagent` listed in [G]. **to verify:** that `delete_file` and `invoke_sub_agent` as direct IDs are accepted here. |
| `includeMcpJson` | `false` | confirmed: [A] (workspace/global `mcp.json` servers are not added) |
| `includePowers` | `false` | confirmed: [A] listed as new in V3 |
| `mcpServers.<name>.command` / `args` | `node` / `["spikes/kiro-agent/mcp-stub/server.mjs"]` | confirmed: [A]. **to verify:** the working directory of the spawned server is the workspace root (the relative script path depends on it). The stub itself finds its files from its own location, so only the launch path depends on this. |
| `mcpServers.<name>.timeout` | `10000` | confirmed: [A] handshake timeout in ms, default 60000 |
| `mcpServers.<name>.requestTimeout` | `20000` | confirmed: [A] per-call timeout in ms, default 120000 |
| MCP server name `mediumstub` (no hyphen) | | chosen to avoid sanitizing: [D] says hook events use a sanitized ID `mcp_<server>_<tool>`. The exact sanitizing rule is not documented. |
| Restrict an MCP server to specific tools | `tools: ["@mediumstub/get_certificate"]` and `permissions` rule `mcp` / `mediumstub/get_certificate` | confirmed: [A] `@server_name/tool_name` selects one tool; [H] `mcp` capability `match` uses `server/tool` names. The stub only exposes one tool anyway. |
| `permissions.rules[]` shape | `capability`, `match`, `exclude`, `effect` | confirmed: [A], [H] |
| `fs_write` allow | `match: ["resurrection/**","deltas.json","harness.json"]`, `effect: allow` | confirmed: [A] shape and example `["src/**","tests/**","Cargo.toml"]`. **to verify:** that the patterns are matched relative to the workspace root, that `resurrection/**` matches `resurrection/hello.txt`, and that it matches a not-yet-existing file ([H]: patterns without wildcards also match children). |
| `fs_write` deny everything else | `exclude: [the three allowed patterns]`, `effect: deny`, no `match` | **to verify.** [H] documents `exclude` ("allow everything except") and the migration page https://kiro.dev/docs/cli/v3/permissions/ shows `{ capability: shell, exclude: [...], effect: deny }` for shell. It is not shown for `fs_write`. If it does not work as intended, the hook and the default (`ask`, which headless mode turns into a denial) still block writes. |
| Deny wins over allow | | confirmed: [H] deny > ask > allow; a deny in any scope wins |
| Unmatched write behaviour in headless mode | | confirmed: [H] "everything else prompts"; [F] a headless run denies a call that needs approval ("tool permission approval is not supported in non-interactive mode"). That message is quoted in [F] for sub-agents; **to verify** that the same happens for a plain write that matches no rule. |
| `fs_read` allow `**` and deny `.env` | `match: ["**"]` allow; `**/.env`, `**/.env.*` deny | confirmed shape [H]. The default already allows workspace reads ([H]); the deny rule keeps secrets out of the transcript. |
| `shell`, `web_fetch`, `web_search` deny `*` | | confirmed: capability names in [H]; shell/web patterns use `*` only. These tools are also not in `tools`, so this is a third layer. |
| `trust` and `allowedTools` | not used | confirmed: [F] V3 headless has no per-agent trust field. Session-wide approval is the CLI flags `--trust-all-tools` / `--trust-tools=<ids>`. [H] says deny rules still apply, and [F] says "A Hook that blocks is final under either flag". Under `--trust-tools`/`--trust-all-tools`, an `ask` becomes approved; a `deny` or a blocking hook does not. |
| `hooks` (inline, in the agent file) | array of `{name, trigger, matcher, action, timeout}` | confirmed: [A] current array form, PascalCase triggers; [F] V3 non-interactive runs load hooks from the selected agent and workspace and a PreToolUse hook can deny a call |
| `hooks[].trigger` | `PreToolUse` | confirmed: [A], [D] |
| `hooks[].matcher` | `^(fs_write\|fs_append\|str_replace\|delete_file)$` | confirmed: [A] shows exactly this regex for `PostToolUse`; [D] says a regex against the tool ID is accepted |
| `hooks[].action` | `{ "type": "command", "command": "node spikes/kiro-agent/hooks/pre-tool-write-guard.mjs" }` | confirmed: [A], [C] ("Command actions run a shell command in your project root"). **to verify:** the relative script path works from that working directory. |
| `hooks[].timeout` | `10` (seconds) | confirmed: [C] seconds, default 60. In an inline hook in an agent file the 2.x conversion example in [A] also places `timeout` at hook level. **to verify:** that the field is read in the inline form. |
| Hook input | JSON on stdin: `hook_event_name`, `cwd`, `session_id`, `tool_name`, `tool_input` | confirmed: [D] (example shown for an MCP tool; same fields for `agentSpawn`). [C] "The command receives session context as JSON on STDIN". |
| Field names inside `tool_input` of `fs_write` | guard reads the first of `path`, `file_path`, `filePath`, `target_file`, `targetFile`, `filename`, `file`, plus a `paths` array | **to verify.** The docs do not list the `tool_input` keys of built-in write tools. The guard blocks a write call that has none of those keys (fail closed). Capture one real event (README, step 6) to learn the real keys. |
| `tool_name` of built-in write tools | `fs_write`, `fs_append`, `str_replace`, `delete_file` | confirmed: [G] tool IDs; [A] matcher example. [U] shows `hook_event_name` camelCase (`preToolUse`) and tool names such as `write` in its example; the guard accepts several spellings. |
| Exit code that blocks a `PreToolUse` call | `2` (stderr text goes to the model) | partly confirmed. [E] says any non-zero exit blocks a Pre Tool Use hook and sends stderr to the agent. [U] (unofficial) says exit 2 denies, exit 0 allows, and any other exit also blocks (fail closed). A third-party gist (https://gist.github.com/njs14/929508f6b9f3bf5d6e50cbe826aa51e0, search snippet only, fetched 2026-11-15) reports exit 1 as "allow with warning" and 2 as "block". The guard uses exit 2 for every deny, which blocks under all three readings. **to verify:** run the README steps and check the blocked write. |
| Hook timeout or crash | treated as block | [U] only. **to verify** if it matters; the guard always exits 0 or 2 itself. |
| `UserPromptSubmit` cannot block in CLI | not used | confirmed: [D] |
| `model` | omitted (default model) | confirmed: [A] field exists; the ID must be one that `/model` lists, and a pinned unavailable model can make the first prompt fail. Not pinned so the draft cannot fail on a wrong ID. `--model <id>` on the command line overrides it ([F]). Run `kiro-cli chat --list-models` to see valid IDs. |
| `welcomeMessage` | omitted | confirmed: [A] optional |

## CLI and headless behavior assumed by the README

| Field / behavior | Value used | Status |
|---|---|---|
| Binary name | `kiro-cli` | confirmed: [I], [F] |
| Version | `kiro-cli --version` (short `-V`) or `kiro-cli version` | confirmed: [I] |
| List agents | `kiro-cli agent list` | confirmed: [I] |
| Validate an agent | `kiro-cli agent validate --path <file>` | confirmed: [I] (the example is in the CLI 1.x/2.x section; **to verify** that V3 still validates against the V3 schema; if the output complains about `permissions`/`excludedTools`, the validator may be the 2.x one) |
| Headless run with an agent | `kiro-cli chat --v3 --no-interactive --agent medium "<prompt>"` | confirmed: [F] (`--agent <name>`; name the harness explicitly with `--v3`; instruction as positional argument) |
| Auth in headless | `KIRO_API_KEY` env var | confirmed: [F]. A logged-in `kiro-cli login` session may also work locally; **to verify** (see `spikes/kiro-headless/README.md`). |
| Stream output | `--output-format stream-json` | confirmed: [F] V2/V3 only |
| Fail if MCP server does not start | `--require-mcp-startup` (exit code 3) | confirmed: [F] |
| Workspace trust prompt | does not apply to `--no-interactive` | confirmed: [H] non-interactive runs are not gated and load workspace config without asking. Interactive V3 asks first. |
| MCP stdio framing | newline-delimited JSON-RPC, no embedded newlines, logs on stderr only | confirmed: [M] |
| MCP methods implemented | `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, plus `ping` | `initialize`/transport confirmed in [M] (framing) only. The message shapes (`protocolVersion`, `capabilities.tools`, `inputSchema`, `content[]`, `isError`) are written from the MCP 2025-06-18 spec and were **not re-fetched** for this spike; **to verify** by checking that Kiro lists the tool (`kiro-cli mcp status --name mediumstub` is not applicable to agent-scoped servers; use the transcript). |
| Credit use of this run | not measured | **to verify** with the credit meter steps in `spikes/kiro-headless/README.md`. Do not quote a number until measured. |
