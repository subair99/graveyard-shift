// Generates two throwaway test agents from spikes/kiro-agent/medium.json for README step 5b
// (enforcement test of the PreToolUse write guard).
//
// RECONSTRUCTED: the user's original one-liner was not provided. This script follows the
// description of that test, not the original code.
//
// Usage (from the repository root):
//   node spikes/kiro-agent/make-guardtest-agents.mjs           write the two agents
//   node spikes/kiro-agent/make-guardtest-agents.mjs --clean   delete only those two files
//
// Output files (in .kiro/agents/, created if missing):
//   guardtest.json           medium.json with a neutral prompt; permissions and hooks kept
//   guardtest-hookonly.json  same, with the "permissions" block removed (the hook is the only gate)
//
// Field names used, read from medium.json on 2026-11-15: name, prompt, permissions, hooks.
// To verify: that Kiro takes the agent name from the file name and that a differing "name"
// field is accepted (both files here have name == file name, so this does not arise).
// To verify: the hook command "node spikes/kiro-agent/hooks/pre-tool-write-guard.mjs" is
// relative to the project root, so run the agents from the repository root.
//
// Node built-ins only. Reads no environment variables and writes no secrets. The output
// is deterministic: 2-space JSON and a trailing newline.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sourcePath = join(here, "medium.json");
const agentsDir = join(repoRoot, ".kiro", "agents");

const GENERATED = ["guardtest", "guardtest-hookonly"];

const NEUTRAL_PROMPT =
  "You are a file-writing assistant for a test of a write guard. Do exactly what the user asks, " +
  "one tool call per file, and report the exact result of each call. If a call is blocked, " +
  "report the message and go on to the next file. Do not look for another way to write a blocked file.";

function filePathFor(name) {
  return join(agentsDir, `${name}.json`);
}

function toJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function clean() {
  // Only the two generated names are ever touched; nothing else is derived from user input.
  for (const name of GENERATED) {
    const p = filePathFor(name);
    if (existsSync(p)) {
      unlinkSync(p);
      console.log(`deleted ${p}`);
    } else {
      console.log(`not present ${p}`);
    }
  }
}

function generate() {
  const medium = JSON.parse(readFileSync(sourcePath, "utf8"));
  for (const field of ["name", "prompt", "permissions", "hooks"]) {
    if (!(field in medium)) {
      console.error(`medium.json has no "${field}" field; stop (field assumption failed).`);
      process.exit(1);
    }
  }

  const base = { ...medium, name: "guardtest", prompt: NEUTRAL_PROMPT };
  base.description = "TEST ONLY. Generated from medium.json by make-guardtest-agents.mjs. Delete after the enforcement test.";

  const hookOnly = { ...base, name: "guardtest-hookonly" };
  delete hookOnly.permissions;

  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(filePathFor("guardtest"), toJson(base));
  writeFileSync(filePathFor("guardtest-hookonly"), toJson(hookOnly));
  console.log(`wrote ${filePathFor("guardtest")} (permissions + hook)`);
  console.log(`wrote ${filePathFor("guardtest-hookonly")} (hook only, no permissions block)`);

  console.log("");
  console.log("Run from the repository root (not run by this script). Set the log first:");
  console.log("  export GUARD_LOG_FILE=/tmp/guardtest-guard.log; rm -f \"$GUARD_LOG_FILE\"");
  console.log("  kiro-cli chat --v3 --no-interactive --agent guardtest \"<prompt from README step 5b>\"");
  console.log("  kiro-cli chat --v3 --no-interactive --agent guardtest-hookonly --trust-tools=fs_write,fs_append,str_replace \"<prompt from README step 5b>\"");
  console.log("");
  console.log("Clean up: node spikes/kiro-agent/make-guardtest-agents.mjs --clean");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  generate();
} else if (args.length === 1 && args[0] === "--clean") {
  clean();
} else {
  console.error("usage: node spikes/kiro-agent/make-guardtest-agents.mjs [--clean]");
  process.exit(64);
}
