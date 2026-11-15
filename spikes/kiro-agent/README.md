# Spike 3: draft `medium` agent for Kiro CLI

Draft custom agent for the future Medium role, with a read-only MCP stub and a write guard hook. Nothing here is wired into the project. Every field and its confirmation status is in `FIELDS.md` (docs fetched 2026-11-15; your CLI version is expected to be 3.3.0 and is unverified).

| File | Purpose |
|---|---|
| `medium.json` | Draft agent (CLI V3 schema) |
| `mcp-stub/server.mjs` | Dependency-free stdio MCP server, one read-only tool `get_certificate` |
| `fixtures/certificate.sample.json` | Obviously fake sample the tool may return |
| `hooks/pre-tool-write-guard.mjs` | PreToolUse hook: allows writes only to `resurrection/**`, `deltas.json`, `harness.json` |
| `hooks/pre-tool-write-guard.test-cases.json`, `hooks/run-cases.mjs` | Offline cases for the guard (a plain script, not part of vitest) |

Run everything from the repository root inside WSL (the examples use `/mnt/c/dev/graveyard-shift`; adjust if you cloned elsewhere). Needs Node 18 or newer in WSL.

## 1. Versions

```bash
cd /mnt/c/dev/graveyard-shift
kiro-cli --version
node --version
```

## 2. Offline checks (no credits)

```bash
node spikes/kiro-agent/hooks/run-cases.mjs
```

Expect `32 passed, 0 failed, 0 skipped` (symlinks work in WSL). Then the MCP stub by hand:

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_certificate","arguments":{}}}' \
 '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_certificate","arguments":{"path":"README.md"}}}' \
 | node spikes/kiro-agent/mcp-stub/server.mjs
```

Expect four JSON lines: the initialize result, the tool list, the fake certificate text, and `"isError":true` with `path not found or not allowed` (id 4). The `[mcp-stub] started` line goes to stderr.

## 3. Validate and list the agent

```bash
kiro-cli agent validate --path spikes/kiro-agent/medium.json
mkdir -p .kiro/agents
cp spikes/kiro-agent/medium.json .kiro/agents/medium.json
kiro-cli agent list
```

The `cp` puts the draft where Kiro looks for project agents (`.kiro/agents/`). It is a temporary copy; step 8 removes it. If `validate` rejects `permissions`, `excludedTools` or `hooks`, the validator may still target the 2.x schema: paste the message and go on.

## 4. Credit meter before

Read the meter the way `spikes/kiro-headless/README.md` describes (written in parallel by another agent; follow it as written) and note the value.

## 5. Run the agent headless

No `--trust-*` flag on purpose: the allow rules in `medium.json` must be enough, and anything else must be denied or blocked.

```bash
export GUARD_LOG_FILE=/tmp/medium-guard.log
rm -f "$GUARD_LOG_FILE"
kiro-cli chat --v3 --no-interactive --require-mcp-startup --agent medium \
 "Do these three things in order and report the exact result of each. (a) Call the get_certificate tool with no arguments and print the package name from it. (b) Write the text 'hello' to resurrection/hello.txt. (c) Write the text 'x' to README.md, then try to write 'x' to ../x. If a write is blocked, say so; do not try another way." \
 2>&1 | tee /tmp/medium-run.txt
```

Optional, to also capture events: add `--output-format stream-json` and redirect stdout to `/tmp/medium-run.jsonl`.

## 6. What to expect

- (a) succeeds. The package name is `example-fake-package`. If the tool is missing, check `--require-mcp-startup` output (exit code 3) and the `command`/working directory in `FIELDS.md`.
- (b) succeeds. `resurrection/hello.txt` exists afterwards.
- (c) both writes are refused. The refusal comes from a permission deny, the hook, or both; the transcript does not necessarily say which. The guard's reason is `write-guard: blocked: ...` on stderr, which Kiro is expected to pass to the model.
- Whether the hook fired: `cat /tmp/medium-guard.log`. One line per write attempt, `ALLOW` for the hello.txt write and `DENY` for the other two. An empty or missing log means the hook did not run (or the environment variable was not passed to it).
- The log also records the raw `path` value of each call. Check it against the real `tool_input` keys: if a line says `no recognizable target path`, the real key is not in the guard's list.

Check the result on disk:

```bash
ls -l resurrection/hello.txt
git status --short
ls ../x 2>&1
```

Expect `resurrection/hello.txt` present, no change to `README.md`, no `../x`.

To test the hook alone (without the permission rules), make a copy without `permissions`, then repeat step 5 with `--agent medium-hookonly`:

```bash
node -e 'const a=require("./spikes/kiro-agent/medium.json");a.name="medium-hookonly";delete a.permissions;require("fs").writeFileSync(".kiro/agents/medium-hookonly.json",JSON.stringify(a,null,2))'
```

With no allow rules, headless mode should deny the unapproved hello.txt write itself; add `--trust-tools=fs_write,fs_append,str_replace` to approve it, and the hook is then the only gate for README.md and `../x`.

## 7. What to paste back

1. `kiro-cli --version`.
2. The output of `kiro-cli agent validate ...` and `kiro-cli agent list` (steps 3).
3. The lines of the transcript for (a), (b), (c), including any `[denied]` or `blocked` text.
4. The contents of `/tmp/medium-guard.log`.
5. The result of `ls -l resurrection/hello.txt`, `git status --short`, `ls ../x`.
6. Credit meter before and after (step 4 and again after the run), exactly as `spikes/kiro-headless/README.md` asks. Do not convert it to a number of your own.
7. Whether the two steering files appear to have been loaded (ask the agent in a second run: "Which steering files do you have in context?").

## 8. Cleanup

```bash
rm -f resurrection/hello.txt
rmdir resurrection 2>/dev/null
rm -f .kiro/agents/medium.json .kiro/agents/medium-hookonly.json
rmdir .kiro/agents 2>/dev/null   # only if it was empty before; skip if you have other agents
rm -f /tmp/medium-guard.log /tmp/medium-run.txt /tmp/medium-run.jsonl
unset GUARD_LOG_FILE
git status --short
```

`git status` should show nothing from this run (`spikes/kiro-agent/` itself is new and untracked until you commit it). Kiro may also have saved a chat session for this directory; list with `kiro-cli chat --list-sessions` and remove with `kiro-cli chat --delete-session <ID>` if you want.
