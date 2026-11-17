// Write_Guard: PreToolUse hook of the Medium agent (medium-agent design Component 3).
// Dependency-free ES module. Exit 0 allows a tool call, exit 2 blocks it and sends stderr to the model.
// The decision logic is exported and pure over an injected file system; `main` runs only when this file is the entry.
// Reads GUARD_LOG_FILE and no other environment variable. Writes nothing to standard output.
import { appendFileSync, lstatSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { escapeControlCharacters, firstControlCharacter, pathRuleProblem } from "./pathRules.mjs";

export const WRITE_TOOLS = Object.freeze([
  "fs_write",
  "fs_append",
  "str_replace",
  "delete_file",
  "write",
  "fsWrite",
  "fsAppend",
  "strReplace",
  "deleteFile",
]);
export const PATH_KEYS = Object.freeze([
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "filename",
  "file",
]);

const MAX_LOGGED_PATH_UNITS = 200;

function deny(reason, tool, paths) {
  return { exitCode: 2, stderrLine: `write-guard: blocked: ${reason}`, tool, reason, paths };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function errorLabel(error) {
  if (error !== null && typeof error === "object") {
    if (typeof error.code === "string" && error.code !== "") return error.code;
    if (typeof error.name === "string" && error.name !== "") return error.name;
  }
  return "unknown";
}

/** The values of the path keys plus the items of a `paths` array, in order. */
function collectTargets(toolInput) {
  if (!isPlainObject(toolInput)) return [];
  const found = [];
  for (const key of PATH_KEYS) {
    if (hasOwn(toolInput, key)) found.push(toolInput[key]);
  }
  if (hasOwn(toolInput, "paths") && Array.isArray(toolInput.paths)) found.push(...toolInput.paths);
  return found;
}

function preResolutionProblem(raw) {
  if (firstControlCharacter(raw) !== null) return "control character in path";
  if (raw.includes("\\")) return "backslash in path";
  if (/^[A-Za-z]:/.test(raw)) return "drive prefix in path";
  if (raw.startsWith("//") || raw.startsWith("~")) return "UNC or home-relative path";
  return null;
}

/** Returns the resolved absolute path, or null for a dangling link in the chain. */
function realResolve(abs, fs) {
  let current = abs;
  const tail = [];
  for (;;) {
    if (fs.lstat(current) !== null) {
      let base;
      try {
        base = fs.realpath(current);
      } catch {
        return null;
      }
      return tail.length > 0 ? join(base, ...tail) : base;
    }
    const parent = dirname(current);
    if (parent === current) return tail.length > 0 ? join(current, ...tail) : current;
    tail.unshift(basename(current));
    current = parent;
  }
}

/** The Root_Relative_Form with `/` separators, or a reason for the refusal. */
function rootRelativeForm(raw, workRoot, fs) {
  const resolved = realResolve(resolve(workRoot, raw), fs);
  if (resolved === null) return { form: null, reason: "dangling or unreadable symbolic link in path" };
  const rel = relative(workRoot, resolved);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { form: null, reason: "outside the work root" };
  }
  return { form: rel.split(sep).join("/"), reason: null };
}

function decideChecked(eventText, fs) {
  let event;
  try {
    event = JSON.parse(eventText);
  } catch {
    return deny("hook event is not valid JSON", null, []);
  }
  if (!isPlainObject(event)) return deny("hook event is not a JSON object", null, []);
  if (typeof event.tool_name !== "string") return deny("hook event has no string tool_name", null, []);
  const tool = event.tool_name;
  if (!WRITE_TOOLS.includes(tool)) {
    return { exitCode: 0, stderrLine: null, tool, reason: "not a write tool", paths: [] };
  }
  const targets = collectTargets(event.tool_input);
  const paths = targets.filter((value) => typeof value === "string");
  if (targets.length === 0) return deny("write tool call has no target path", tool, paths);
  if (targets.some((value) => typeof value !== "string" || value === "")) {
    return deny("target path is missing, empty or not a string", tool, paths);
  }
  let workRoot;
  try {
    if (typeof event.cwd !== "string" || event.cwd === "") throw new Error("no cwd");
    workRoot = fs.realpath(resolve(event.cwd));
  } catch {
    return deny("cannot resolve the working directory", tool, paths);
  }
  for (const raw of paths) {
    const early = preResolutionProblem(raw);
    if (early !== null) return deny(early, tool, paths);
  }
  for (const raw of paths) {
    const { form, reason } = rootRelativeForm(raw, workRoot, fs);
    if (form === null) return deny(reason, tool, paths);
    const problem = pathRuleProblem(form);
    if (problem !== null) return deny(problem, tool, paths);
  }
  return { exitCode: 0, stderrLine: null, tool, reason: "allowed", paths };
}

/** Never throws: an internal error is a block whose reason holds the error code or name only. */
export function decide(eventText, fs) {
  try {
    return decideChecked(eventText, fs);
  } catch (error) {
    return deny(`internal error: ${errorLabel(error)}`, null, []);
  }
}

/** One Guard_Log line, with a trailing line feed. */
export function formatLogLine(decision, at) {
  const parts = [at.toISOString(), decision.exitCode === 0 ? "ALLOW" : "DENY"];
  if (typeof decision.tool === "string") parts.push(`tool=${escapeControlCharacters(decision.tool)}`);
  parts.push(`reason=${escapeControlCharacters(decision.reason)}`);
  for (const path of decision.paths) {
    parts.push(`path=${escapeControlCharacters(path.slice(0, MAX_LOGGED_PATH_UNITS))}`);
  }
  return `${parts.join(" ")}\n`;
}

const realFs = {
  lstat(p) {
    try {
      return lstatSync(p);
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
      throw error;
    }
  },
  realpath(p) {
    return realpathSync(p);
  },
};

function writeStderr(text) {
  try {
    writeSync(2, text);
  } catch {
    /* nothing more can be done */
  }
}

function main() {
  let decision;
  try {
    decision = decide(readFileSync(0, "utf8"), realFs);
  } catch (error) {
    decision = deny(`internal error: ${errorLabel(error)}`, null, []);
  }
  if (decision.stderrLine !== null) writeStderr(`${decision.stderrLine}\n`);
  const logFile = process.env.GUARD_LOG_FILE;
  if (typeof logFile === "string" && logFile !== "") {
    try {
      appendFileSync(logFile, formatLogLine(decision, new Date()));
    } catch {
      /* logging never changes the decision */
    }
  }
  process.exit(decision.exitCode);
}

function isProcessEntry() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isProcessEntry()) {
  try {
    main();
  } catch {
    process.exit(2);
  }
}
