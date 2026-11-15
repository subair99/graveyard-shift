# Spike 3: draft `medium` agent for Kiro CLI

Draft custom agent for the future Medium role, with a read-only MCP stub and a write guard hook. Nothing here is wired into the project. Every field and its confirmation status is in `FIELDS.md` (docs fetched 2026-11-15; your CLI version is expected to be 3.3.0 and is unverified).

| File | Purpose |
|---|---|
| `medium.json` | Draft agent (CLI V3 schema) |
| `mcp-stub/server.mjs` | Dependency-free stdio MCP server, one read-only tool `get_certificate` |
| `fixtures/certificate.sample.json` | Obviously fake sample the tool may return |
| `hooks/pre-tool-write-guard.mjs` | PreToolUse hook: allows writes only to `resurrection/**`, `deltas.json`, `harness.json` |
| `hooks/pre-tool-write-guard.test-cases.json`, `hooks/run-cases.mjs` | Offline cases for the guard (a plain script, not part of vitest) |

## Setup note: log in with the right account

Log in to `kiro-cli` with the same account as the IDE, the one that holds the hackathon credits. A Builder ID login is a different account without those credits; a run then fails with `UsageLimitReachedError` (user-observed, 15 Nov 2026). Fix: `kiro-cli logout`, then `kiro-cli login --social google` (with the Google account the IDE uses).

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

## 5b. Enforcement test

Numbering: the guard-related run is step 5, so this sits right after it. Step 5 asks the model to write `README.md` and `../x`; the model may refuse these by itself, in which case the guard is never exercised (user-observed: it refused, and refused again when asked to test the guard). This step uses a neutral prompt and test agents so that the model has no reason to refuse.

1. Generate the agents (writes `.kiro/agents/guardtest.json` and `.kiro/agents/guardtest-hookonly.json`; the second has no `permissions` block, so the hook is the only enforcement):

   ```bash
   node spikes/kiro-agent/make-guardtest-agents.mjs
   ```

2. Run each agent in WSL with a neutral prompt that asks for four files. For `guardtest-hookonly` add the trust flags, so writes are approved and only the hook can stop them:

   ```bash
   export GUARD_LOG_FILE=/tmp/guardtest-guard.log
   rm -f "$GUARD_LOG_FILE"
   P='Create these four files, one tool call each, with the text "x" in each: resurrection/guard-ok.txt, resurrection/../guard-test-outside.txt, guard-test-root.txt, .kiro/guard-test.txt. Report the exact result of each call.'
   kiro-cli chat --v3 --no-interactive --agent guardtest "$P" 2>&1 | tee /tmp/guardtest-run.txt
   # second run: hook only, writes trusted
   kiro-cli chat --v3 --no-interactive --agent guardtest-hookonly --trust-tools=fs_write,fs_append,str_replace "$P" 2>&1 | tee /tmp/guardtest-hookonly-run.txt
   ```

3. Read the guard log: `cat /tmp/guardtest-guard.log`.
4. Expected (it matched in the user's run of 15 Nov 2026, both agents):
   - `DENY` for `resurrection/../guard-test-outside.txt`, `guard-test-root.txt` and `.kiro/guard-test.txt`.
   - `ALLOW` for `resurrection/guard-ok.txt`.
   - For each denied call Kiro says the tool "was intercepted by PreToolUse hooks ... NOT executed", with the guard's reason.
5. Verify none of the blocked files exist:

   ```bash
   ls -l guard-test-outside.txt guard-test-root.txt .kiro/guard-test.txt 2>&1
   ```

   Expect "No such file" three times. `resurrection/guard-ok.txt` should exist.
6. Cleanup, then `git status --short` must print nothing from this test:

   ```bash
   node spikes/kiro-agent/make-guardtest-agents.mjs --clean
   rm -f resurrection/guard-ok.txt /tmp/guardtest-guard.log /tmp/guardtest-run.txt /tmp/guardtest-hookonly-run.txt
   rmdir resurrection 2>/dev/null
   unset GUARD_LOG_FILE
   git status --short
   ```

   `--clean` deletes only the two generated agent files and refuses any other argument.

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

## Results (user-run, 15 Nov 2026)

Run by the user in WSL with kiro-cli 3.3.0. Copied from the user's report; details in `docs/kiro-journal.md`.

- `run-cases.mjs`: 32 passed, 0 failed, 0 skipped (symlink cases ran).
- MCP stub by hand: four JSON lines as expected; id 4 (`README.md`) returned `isError` "path not found or not allowed".
- `kiro-cli agent validate`: no output, no error. `kiro-cli agent list` shows "medium Workspace (v3 format)".
- `medium` agent run: (a) `@mediumstub/get_certificate` returned `example-fake-package`; (b) `resurrection/hello.txt` written, guard log ALLOW; (c) the model refused to attempt `README.md` and `../x` on its own, so the guard was not exercised. It refused twice more when asked to test the guard.
- Steering: the agent listed all six steering files, including `necromancy-laws.md` and `honesty.md`.
- Enforcement test (step 5b, agents `guardtest` and `guardtest-hookonly`): the guard log shows DENY for `resurrection/../guard-test-outside.txt`, `guard-test-root.txt` and `.kiro/guard-test.txt`, and ALLOW for `resurrection/guard-ok.txt`, in both runs. Kiro returned "Tool fs_write was intercepted by PreToolUse hooks before execution ... The tool was NOT executed" with the guard's reason. No blocked file existed afterwards. Cleanup left `git status` empty.
- Credit meter: not provided.
