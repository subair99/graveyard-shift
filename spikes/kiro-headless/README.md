# Spike 2: Kiro CLI headless on GitHub Actions

> **Spike not run. Headless mode is unavailable for this account.** app.kiro.dev shows no "API Keys" page on the user's account (reported by the user, 15 Nov 2026), so no API key can be created. The workflow `.github/workflows/spike-kiro.yml` was removed. This directory is kept only as documentation of what the docs said on 2026-11-15, **unverified**. The steps below were never executed, and the references to `spike-kiro.yml` below point to a removed file. See `docs/kiro-journal.md` ("Spikes 2 and 7: skipped; spike-kiro.yml removed").

Throwaway. The workflow `.github/workflows/spike-kiro.yml` has been removed; delete this directory when it is no longer wanted.

All facts below were fetched on **2026-11-15**. Paraphrased from the cited pages. "To verify" means the docs did not
confirm it or the spike must measure it.

## Account note

Use the account that holds the hackathon credits: a local `kiro-cli` login with a Builder ID is a different account without those credits (user-observed on 15 Nov 2026, `UsageLimitReachedError`; fixed by `kiro-cli login --social google` with the IDE's Google account). For headless, the API key belongs to one account, and which credits that key draws on is to verify.

## What the spike checks

1. Headless mode works with an API key on your plan.
2. Whether bonus credits are consumed (and in what order relative to plan credits).
3. The credit cost of one trivial call, and its elapsed time.

The workflow (`.github/workflows/spike-kiro.yml`, removed) installed the CLI, prints its version, then runs one prompt with no
tools trusted.

## Research findings

### (a) Install on ubuntu-latest

- Documented method: `curl -fsSL https://cli.kiro.dev/install | bash`
  ([headless docs](https://kiro.dev/docs/cli/headless/) example workflow; [installation](https://kiro.dev/docs/getting-started/installation/)).
- The binary is `kiro-cli`; version flag `--version` / `-V` ([CLI commands](https://kiro.dev/docs/reference/cli-commands/)).
  Since 3.0.0 it is a single standalone binary ([installation](https://kiro.dev/docs/getting-started/installation/)).
- Linux needs glibc 2.34+ or the musl build (same installation page). The script picks the build itself.
- Checksum: the script ([source](https://cli.kiro.dev/install)) downloads `manifest.json` (or `index.json` for
  `--version`) from `prod.download.cli.kiro.dev`, then verifies the zip's sha256 against it before installing. Both files
  come from the same host, so this catches corruption, not a compromised host. A detached signature: none found, **to verify**.
- Script options seen in its source: `--version X.Y.Z`, `--force`, `--no-modify-path`, `--channel`. It installs to `~/.local/bin`
  and needs `curl`, `unzip`, `sha256sum` (present on ubuntu-latest, to verify in the run).
- Latest stable on 2026-11-15: **3.3.0** ([manifest](https://prod.download.cli.kiro.dev/stable/latest/manifest.json),
  Linux x86_64 headless zip sha256 `018e7d19124ebf5088bc33b12dcafa5c7e8de745ae491df024afebcd19f36b62`). The workflow pins
  `--version 3.3.0` through the script; it does not check that hash itself. Whether `index.json` lists 3.3.0: to verify (the run shows it).
- **Unpinned**: the install script is fetched live and not pinned to a hash. The workflow prints its sha256 only. To verify.

### (b) Headless invocation

Source: [headless docs](https://kiro.dev/docs/cli/headless/), [exit codes](https://kiro.dev/docs/reference/exit-codes/),
[CLI commands](https://kiro.dev/docs/reference/cli-commands/).

- `kiro-cli chat --v3 --no-interactive "<prompt>"`. The prompt is a positional argument, or piped on stdin when no
  positional is given (not both). The docs recommend naming `--v2` or `--v3` in every headless command. `--v3` is used here.
- Agent: `--agent <name>`; without it a V3 run uses `chat.defaultAgent` or the built-in default.
- Output: plain text on stdout by default; `--output-format stream-json` gives JSON Lines (V2/V3 only).
- Exit codes: 0 success; 1 general failure (auth error, invalid args); 3 MCP startup failure (`--require-mcp-startup`);
  4 named agent not found.
- Tool trust: `--trust-all-tools` approves everything; `--trust-tools=<ids>` approves a list. With neither, a tool call in a
  non-interactive run is denied with an error message instead of waiting for approval. The workflow uses **neither**, the
  most restrictive option, since the prompt needs no tool. Whether the model still tries a tool and the run exits non-zero: to verify.
- Timeouts: a V3 run waits up to 6 hours for in-flight workflows (`KIRO_HEADLESS_WORKFLOW_TIMEOUT_SECS`). The workflow wraps the
  call in `timeout 240` and the job in `timeout-minutes: 5`.

### (c) API key and plans

Source: [authentication](https://kiro.dev/docs/getting-started/authentication/),
[headless blog](https://kiro.dev/blog/introducing-headless-mode/).

- Create: sign in to **app.kiro.dev** with a Kiro Pro, Pro+, Pro Max or Power account, open the **API Keys** section,
  create a new key, name it, copy it. The full value (prefix `ksk_`) is shown only at creation. Exact button labels: to verify.
- Plans: the page names Pro, Pro+, Pro Max and Power for API keys. Free is not listed. Whether Free can create a key: **to verify**.
  Enterprise / IAM Identity Center users: not covered on that page, to verify.
- Tiers and monthly credits ([billing](https://kiro.dev/docs/billing/)): Free 50, Pro 1,000, Pro+ 2,000, Pro Max 5,000,
  Power 10,000. Add-on credits are for paid tiers only.
- Credits used through an API key are deducted from the subscription credits (authentication page).
- First upgrade from Free on or after 2026-11-01: rest of the month on Pro free, plus 500 trial credits (billing page).

### (d) Reading the credit meter

- **Kiro Web**: choose your email address in the navigation pane, then Settings; section "Estimated Usage"
  ([AWS re:Post](https://www.repost.aws/knowledge-center/kiro-track-usage)). Whether app.kiro.dev is the same Kiro Web: to verify.
  Add-on credits purchased appear on the account page ([add-on credits](https://kiro.dev/docs/billing/add-on-credits/)).
- **IDE**: status bar at the bottom (re:Post page above).
- **CLI**: `/usage` in a chat session ([slash commands](https://kiro.dev/docs/reference/slash-commands/)). The docs say that in
  non-interactive runs `/usage` prints the full usage breakdown, and in 3.1.0+ it shows the credits the current session used.
  So `kiro-cli chat --no-interactive "/usage"` should work; whether it works with only an API key and whether it costs a credit: to verify.
- Does a headless run print usage? Not documented, to verify (read the run log). A third-party sample page suggests no token counts
  are reported ([aws-samples](https://github.com/aws-samples/sample-agentic-coding-harness-benchmarks/blob/main/docs/kiro-cli-setup.md), snippet only, not read in full).
- Credit order, from the docs: plan credits first, then trial credits ([billing](https://kiro.dev/docs/billing/));
  add-on credits only after plan credits are exhausted ([add-on credits](https://kiro.dev/docs/billing/add-on-credits/)).
  The free-tier "welcome bonus" credits are not covered by those pages, **to verify**. A user report shows `/usage` listing them on a separate
  "Bonus Credits" line ([issue 7806](https://github.com/kirodotdev/Kiro/issues/7806)), so you can see which line moves. Credits are fractional
  (billing page), so read at the highest precision shown.

### (e) Limits, telemetry

- No headless-specific rate limit is documented. Users report throttling messages ("Too many requests") on paid accounts
  ([issue 12336](https://github.com/kirodotdev/Kiro/issues/12336), [issue 8998](https://github.com/kirodotdev/Kiro/issues/8998)). To verify for your plan.
- Settings ([settings reference](https://kiro.dev/docs/reference/settings/)): `api.timeout` 3600 s per streamed response,
  stream idle hard timeout 300 s, transient throttling/5xx errors retried with backoff automatically.
- Data sharing ([data protection](https://kiro.dev/docs/privacy-and-security/data-protection/)): Free and individual subscribers
  (social login or Builder ID) share content for service improvement and telemetry by default, subject to opt-out; enterprise users do not.
  The documented opt-out is in the IDE (Settings > User > Application > Telemetry and Content). The CLI has `kiro-cli settings telemetry.enabled`
  (settings reference). A CLI/API-key content opt-out: to verify. The spike prompt is a fixed trivial sentence, so exposure is nil.

## To verify (summary)

1. Your plan name, and that it can create an API key (Free: unclear).
2. Exact labels in app.kiro.dev for API Keys.
3. `index.json` lists 3.3.0 and the install succeeds; no signature published for the script or zip.
4. A run with no trust flags exits 0 and prints OK.
5. Whether `/usage` works non-interactively with an API key, and whether it costs credits.
6. Which balance (plan, trial, bonus) the call decrements; the cost of one call.
7. Any throttling on a first call.

## Pinned action

`actions/checkout` `v7.0.1` = `3d3c42e5aac5ba805825da76410c181273ba90b1`. Latest release on 2026-11-15 is v7.0.1
(`https://api.github.com/repos/actions/checkout/releases/latest`), same major as `ci.yml` (v7).
`https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1` returned `object.type` = `commit` with that SHA (lightweight tag, no
dereference needed); `.../tags/v7` returned the same SHA.

## Steps for you

### 1. Read the meter BEFORE

1. Open <https://app.kiro.dev>, sign in, choose your email address, then Settings, then "Estimated Usage". Write down the time (with time zone),
   the plan name, every balance shown (plan, trial/bonus, add-on) at full precision. Screenshot it.
2. Optional, CLI: install locally (`curl -fsSL https://cli.kiro.dev/install | bash`), run `kiro-cli login`, then
   `kiro-cli chat --no-interactive "/usage"` (or run `kiro-cli`, then type `/usage`). Paste the output. If you log in locally, run `kiro-cli logout` afterwards.

### 2. Create the API key

1. At <https://app.kiro.dev> open **API Keys**, create a key named `graveyard-shift-spike`, copy it. It is shown once.
2. If there is no API Keys section or the plan refuses, stop and report the plan name and what you see.

### 3. Store it as an environment secret

GitHub repository > Settings > Environments > New environment, name `medium` > Configure.
Under "Deployment branches and tags" choose "Selected branches and tags", add `main`.
Under "Environment secrets" > Add environment secret: name `KIRO_API_KEY`, value the key. Do not add it as a repository secret.

### 4. Get the workflow on main, then dispatch

The workflow must be on the default branch to appear in the UI. Merge it to `main` first.

- (Not applicable: `spike-kiro.yml` was removed and this step was never run.)
- UI: Actions > spike-kiro > Run workflow > branch `main` > Run workflow.
- CLI: `gh workflow run spike-kiro.yml --ref main`, then `gh run watch`, then `gh run view --log`.

### 5. Read the meter AFTER

Wait a few minutes (the usage display may lag, to verify). Repeat step 1 with a new timestamp.

### 6. Paste back

- Plan name.
- Log of the "kiro-cli --version" step and the "Headless prompt" step (the key is not printed; check before pasting).
- The notice line: exit code and elapsed seconds.
- Meter readings before and after with timestamps, per balance (plan, bonus/trial, add-on).

### 7. Clean up

1. Revoke the API key in app.kiro.dev (API Keys).
2. Delete the environment `medium` or its secret.
3. `.github/workflows/spike-kiro.yml` is already removed; delete `spikes/kiro-headless/` when no longer wanted.
4. If you ran `kiro-cli login` locally and no longer need it: `kiro-cli logout`.
