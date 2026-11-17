// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 13.4
// A checker over the parsed .kiro/agents/medium.json that names each broken criterion or path,
// and a table of single mutations of the committed file that the checker must reject. No kiro-cli.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { WRITE_TOOLS } from "../../../src/pipeline/medium/agent/writeGuard.mjs";

const ROOT = join(__dirname, "..", "..", "..");
const AGENT_PATH = join(ROOT, ".kiro", "agents", "medium.json");

const CONTEXT_TOOLS = [
  "get_certificate",
  "get_eligibility",
  "get_advisories",
  "list_original_files",
  "read_original_file",
  "get_preset_menu",
];
const BASE_TOOLS = ["read_file", "list_directory", "fs_write", "fs_append", "str_replace"];
const EXCLUDED = ["shell", "web", "subagent", "invoke_sub_agent", "delete_file"];
const RESOURCES = ["file://.kiro/steering/necromancy-laws.md", "file://.kiro/steering/honesty.md"];
const WRITE_PATTERNS = ["resurrection/**", "deltas.json", "harness.json"];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameSet(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item) => actual.filter((entry) => entry === item).length === 1)
  );
}

function scriptTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => /\.(mjs|cjs|js|ts)$/.test(token));
}

/** Returns one message per broken criterion or path, each starting with "Requirement <n>: ". */
export function checkAgentDefinition(text: string, root: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return ["Requirement 1.7: not valid JSON"];
  }
  if (!isObject(parsed)) return ["Requirement 1.7: top level is not an object"];
  const def = parsed;
  const problems: string[] = [];
  const add = (criterion: string, message: string): void => {
    problems.push(`Requirement ${criterion}: ${message}`);
  };

  // 1.1
  if ("name" in def && def["name"] !== "medium") add("1.1", `name is ${JSON.stringify(def["name"])}, not "medium"`);

  // 1.5 (server key is needed by 1.2 and 2.4)
  const servers = def["mcpServers"];
  const serverKeys = isObject(servers) ? Object.keys(servers) : [];
  if (serverKeys.length !== 1) add("1.5", `mcpServers has ${serverKeys.length} keys, expected 1`);
  const serverKey = serverKeys[0] ?? "<server>";
  const server = isObject(servers) ? servers[serverKey] : undefined;
  const serverArgs: string[] = [];
  if (server !== undefined) {
    if (!isObject(server)) {
      add("1.5", "the mcpServers entry is not an object");
    } else {
      if (server["command"] !== "node") add("1.5", `command is ${JSON.stringify(server["command"])}, not "node"`);
      const args = server["args"];
      if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
        add("1.5", "args is not an array of strings");
      } else {
        serverArgs.push(...(args as string[]));
        const at = serverArgs.indexOf("--context");
        if (at < 0 || serverArgs[at + 1] !== ".graveyard-work/medium-context") {
          add("1.5", "args lack `--context` followed by `.graveyard-work/medium-context`");
        }
        if (!serverArgs[0]?.endsWith("src/pipeline/medium/agent/contextServer.mjs")) {
          add("1.5", "args[0] is not the Context_Server file of the Agent_Directory");
        }
      }
    }
  }

  // 1.2
  const tools = def["tools"];
  const expectedTools = [...BASE_TOOLS, ...CONTEXT_TOOLS.map((tool) => `@${serverKey}/${tool}`)];
  if (!sameSet(tools, expectedTools)) add("1.2", "tools is not exactly the five base tools and six Context_Server tools");

  // 1.3
  if (!sameSet(def["excludedTools"], EXCLUDED)) add("1.3", "excludedTools is not exactly the five excluded tools");
  if (def["includeMcpJson"] !== false) add("1.3", "includeMcpJson is not false");
  if (def["includePowers"] !== false) add("1.3", "includePowers is not false");

  // 1.4
  const resources = def["resources"];
  for (const resource of RESOURCES) {
    if (!Array.isArray(resources) || !resources.includes(resource)) add("1.4", `resources lack ${resource}`);
    else if (!existsSync(join(root, resource.slice("file://".length)))) add("1.4", `${resource} does not exist`);
  }

  // 1.6
  for (const key of ["model", "trust", "allowedTools", "toolsSettings"]) {
    if (key in def) add("1.6", `top-level field ${key} is present`);
  }

  // 1.7: prompt
  if (typeof def["prompt"] !== "string") add("1.7", "prompt is not an inline string");
  else if (/^file:\/\//.test(def["prompt"].trim())) add("1.7", "prompt is a file:// reference");

  // 2.x: permission rules
  const permissions = def["permissions"];
  const rules: Json[] =
    isObject(permissions) && Array.isArray(permissions["rules"]) ? permissions["rules"].filter(isObject) : [];
  const find = (capability: string, effect: string): Json[] =>
    rules.filter((rule) => rule["capability"] === capability && rule["effect"] === effect);
  const writeAllow = find("fs_write", "allow");
  const writeDeny = find("fs_write", "deny");
  if (writeAllow.length !== 1 || !sameSet(writeAllow[0]?.["match"], WRITE_PATTERNS) || "exclude" in (writeAllow[0] ?? {})) {
    add("2.1", "fs_write allow entry is missing, duplicated, has the wrong match or has an exclude");
  }
  if (writeDeny.length !== 1 || !sameSet(writeDeny[0]?.["exclude"], WRITE_PATTERNS) || "match" in (writeDeny[0] ?? {})) {
    add("2.1", "fs_write deny entry is missing, duplicated, has the wrong exclude or has a match");
  }
  for (const capability of ["shell", "web_fetch", "web_search"]) {
    const entries = find(capability, "deny");
    if (entries.length < 1 || !entries.some((rule) => sameSet(rule["match"], ["*"]))) {
      add("2.2", `no deny entry with match ["*"] for ${capability}`);
    }
  }
  const readAllow = find("fs_read", "allow");
  if (readAllow.length !== 1 || !sameSet(readAllow[0]?.["match"], ["**"])) {
    add("2.3", "fs_read allow entry is missing, duplicated or its match is not [\"**\"]");
  }
  const readDeny = find("fs_read", "deny");
  const denies = (pattern: string): boolean =>
    readDeny.some((rule) => Array.isArray(rule["match"]) && rule["match"].includes(pattern));
  if (!denies("**/.env") || !denies("**/.env.*")) add("2.3", "fs_read deny does not match both **/.env and **/.env.*");
  const mcpAllow = find("mcp", "allow");
  if (
    mcpAllow.length !== 1 ||
    !sameSet(
      mcpAllow[0]?.["match"],
      CONTEXT_TOOLS.map((tool) => `${serverKey}/${tool}`),
    )
  ) {
    add("2.4", "mcp allow entry is missing, duplicated or does not list exactly the six tools without wildcard");
  }
  const allowed = rules.filter((rule) => rule["effect"] === "allow");
  if (allowed.length !== writeAllow.length + readAllow.length + mcpAllow.length || allowed.length !== 3) {
    add("2.5", `there are ${allowed.length} allow entries; only the fs_write, fs_read and mcp entries are allowed`);
  }

  // 3.1
  const hooks = def["hooks"];
  const hookList: Json[] = Array.isArray(hooks) ? hooks.filter(isObject) : [];
  if (!Array.isArray(hooks) || hookList.length !== 1) {
    add("3.1", "hooks does not hold exactly one hook");
  } else {
    const hook = hookList[0] as Json;
    const action = hook["action"];
    if (hook["trigger"] !== "PreToolUse") add("3.1", "hook trigger is not PreToolUse");
    if (!isObject(action) || action["type"] !== "command") add("3.1", "hook action is not of type command");
    if (typeof hook["matcher"] !== "string") {
      add("3.1", "hook matcher is not a string");
    } else {
      let matcher: RegExp | null = null;
      try {
        matcher = new RegExp(hook["matcher"]);
      } catch {
        add("3.1", "hook matcher is not a valid regular expression");
      }
      if (matcher !== null) {
        for (const name of WRITE_TOOLS) {
          if (!matcher.test(name)) add("3.1", `hook matcher does not match Write_Tool ${name}`);
        }
      }
    }
  }

  // 1.7: script paths of mcpServers args and hook commands
  const scripts = [...serverArgs.flatMap(scriptTokens)];
  for (const hook of hookList) {
    const action = hook["action"];
    if (isObject(action) && typeof action["command"] === "string") scripts.push(...scriptTokens(action["command"]));
  }
  for (const script of scripts) {
    if (script.startsWith("spikes/") || script.includes("/spikes/")) add("1.7", `script path ${script} lies under spikes/`);
    else if (!existsSync(join(root, script))) add("1.7", `script path ${script} does not exist`);
  }

  // 13.4
  if (text.includes("spikes/")) add("13.4", "the text contains the substring spikes/");

  return problems;
}

const committedText = readFileSync(AGENT_PATH, "utf8");

function mutate(change: (def: Json) => void): string {
  const def = JSON.parse(committedText) as Json;
  change(def);
  return JSON.stringify(def);
}

function ruleList(def: Json): Json[] {
  return (def["permissions"] as { rules: Json[] }).rules;
}

function ruleIndex(def: Json, capability: string, effect: string): number {
  return ruleList(def).findIndex((rule) => rule["capability"] === capability && rule["effect"] === effect);
}

function hookOf(def: Json): Json {
  return (def["hooks"] as Json[])[0] as Json;
}

function serverOf(def: Json): Json {
  const servers = def["mcpServers"] as Record<string, Json>;
  return servers["mediumcontext"] as Json;
}

const MUTATIONS: ReadonlyArray<{ name: string; criterion: string; text: () => string }> = [
  { name: "name is not medium", criterion: "1.1", text: () => mutate((d) => (d["name"] = "other")) },
  {
    name: "a base tool is missing",
    criterion: "1.2",
    text: () => mutate((d) => (d["tools"] = (d["tools"] as string[]).filter((t) => t !== "read_file"))),
  },
  {
    name: "a tool is listed twice",
    criterion: "1.2",
    text: () => mutate((d) => (d["tools"] as string[]).push("fs_write")),
  },
  { name: "an extra tool", criterion: "1.2", text: () => mutate((d) => (d["tools"] as string[]).push("shell")) },
  {
    name: "a context tool is missing",
    criterion: "1.2",
    text: () =>
      mutate((d) => (d["tools"] = (d["tools"] as string[]).filter((t) => t !== "@mediumcontext/get_preset_menu"))),
  },
  {
    name: "an excluded tool is missing",
    criterion: "1.3",
    text: () => mutate((d) => (d["excludedTools"] = (d["excludedTools"] as string[]).filter((t) => t !== "shell"))),
  },
  { name: "includeMcpJson is true", criterion: "1.3", text: () => mutate((d) => (d["includeMcpJson"] = true)) },
  { name: "includePowers is true", criterion: "1.3", text: () => mutate((d) => (d["includePowers"] = true)) },
  {
    name: "a steering resource is missing",
    criterion: "1.4",
    text: () => mutate((d) => (d["resources"] = [RESOURCES[0]])),
  },
  {
    name: "a steering resource names a missing file",
    criterion: "1.4",
    text: () => mutate((d) => (d["resources"] = [RESOURCES[0], "file://.kiro/steering/missing-file.md"])),
  },
  {
    name: "a second mcp server",
    criterion: "1.5",
    text: () => mutate((d) => ((d["mcpServers"] as Json)["other"] = { command: "node", args: [] })),
  },
  { name: "command is not node", criterion: "1.5", text: () => mutate((d) => (serverOf(d)["command"] = "bash")) },
  {
    name: "--context pair is missing",
    criterion: "1.5",
    text: () =>
      mutate((d) => (serverOf(d)["args"] = ["src/pipeline/medium/agent/contextServer.mjs"])),
  },
  {
    name: "context directory differs",
    criterion: "1.5",
    text: () =>
      mutate(
        (d) => (serverOf(d)["args"] = ["src/pipeline/medium/agent/contextServer.mjs", "--context", "somewhere/else"]),
      ),
  },
  { name: "model is set", criterion: "1.6", text: () => mutate((d) => (d["model"] = "some-model")) },
  { name: "trust is set", criterion: "1.6", text: () => mutate((d) => (d["trust"] = true)) },
  { name: "allowedTools is set", criterion: "1.6", text: () => mutate((d) => (d["allowedTools"] = ["fs_write"])) },
  { name: "toolsSettings is set", criterion: "1.6", text: () => mutate((d) => (d["toolsSettings"] = {})) },
  { name: "not valid JSON", criterion: "1.7", text: () => committedText.slice(0, committedText.length - 3) },
  {
    name: "prompt is a file:// reference",
    criterion: "1.7",
    text: () => mutate((d) => (d["prompt"] = "file://./prompt.md")),
  },
  { name: "prompt is not a string", criterion: "1.7", text: () => mutate((d) => (d["prompt"] = ["a", "b"])) },
  {
    name: "server script path does not exist",
    criterion: "1.7",
    text: () =>
      mutate((d) => {
        (serverOf(d)["args"] as string[])[0] = "src/pipeline/medium/agent/missingServer.mjs";
      }),
  },
  {
    name: "hook script path does not exist",
    criterion: "1.7",
    text: () =>
      mutate((d) => {
        (hookOf(d)["action"] as Json)["command"] = "node src/pipeline/medium/agent/missingGuard.mjs";
      }),
  },
  {
    name: "hook script path lies under spikes/",
    criterion: "1.7",
    text: () =>
      mutate((d) => {
        (hookOf(d)["action"] as Json)["command"] = "node spikes/kiro-agent/hooks/pre-tool-write-guard.mjs";
      }),
  },
  {
    name: "fs_write allow has an extra pattern",
    criterion: "2.1",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "fs_write", "allow")]?.["match"] as string[]).push("src/**");
      }),
  },
  {
    name: "fs_write deny is removed",
    criterion: "2.1",
    text: () => mutate((d) => ruleList(d).splice(ruleIndex(d, "fs_write", "deny"), 1)),
  },
  {
    name: "fs_write allow has an exclude",
    criterion: "2.1",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "fs_write", "allow")] as Json)["exclude"] = ["x"];
      }),
  },
  {
    name: "shell deny is removed",
    criterion: "2.2",
    text: () => mutate((d) => ruleList(d).splice(ruleIndex(d, "shell", "deny"), 1)),
  },
  {
    name: "web_fetch deny match is not *",
    criterion: "2.2",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "web_fetch", "deny")] as Json)["match"] = ["example.com"];
      }),
  },
  {
    name: "web_search is allowed instead of denied",
    criterion: "2.2",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "web_search", "deny")] as Json)["effect"] = "allow";
      }),
  },
  {
    name: "fs_read allow is narrowed",
    criterion: "2.3",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "fs_read", "allow")] as Json)["match"] = ["src/**"];
      }),
  },
  {
    name: "fs_read deny lacks **/.env.*",
    criterion: "2.3",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "fs_read", "deny")] as Json)["match"] = ["**/.env"];
      }),
  },
  {
    name: "mcp allow misses a tool",
    criterion: "2.4",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "mcp", "allow")]?.["match"] as string[]).pop();
      }),
  },
  {
    name: "mcp allow uses a wildcard",
    criterion: "2.4",
    text: () =>
      mutate((d) => {
        (ruleList(d)[ruleIndex(d, "mcp", "allow")] as Json)["match"] = ["mediumcontext/*"];
      }),
  },
  {
    name: "an extra allow entry",
    criterion: "2.5",
    text: () => mutate((d) => ruleList(d).push({ capability: "shell", match: ["git status"], effect: "allow" })),
  },
  {
    name: "matcher misses most Write_Tools",
    criterion: "3.1",
    text: () =>
      mutate((d) => {
        hookOf(d)["matcher"] = "^fs_write$";
      }),
  },
  {
    name: "matcher misses one Write_Tool",
    criterion: "3.1",
    text: () =>
      mutate((d) => {
        hookOf(d)["matcher"] = "^(fs_write|fs_append|str_replace|write|fsWrite|fsAppend|strReplace|deleteFile)$";
      }),
  },
  {
    name: "a second hook",
    criterion: "3.1",
    text: () => mutate((d) => (d["hooks"] as Json[]).push(structuredClone(hookOf(d)))),
  },
  {
    name: "hook trigger is PostToolUse",
    criterion: "3.1",
    text: () =>
      mutate((d) => {
        hookOf(d)["trigger"] = "PostToolUse";
      }),
  },
  {
    name: "hook action is not a command",
    criterion: "3.1",
    text: () =>
      mutate((d) => {
        hookOf(d)["action"] = { type: "agent", prompt: "x" };
      }),
  },
  {
    name: "the text contains spikes/",
    criterion: "13.4",
    text: () => mutate((d) => (d["description"] = `${String(d["description"])} See spikes/kiro-agent.`)),
  },
];

describe("the committed Agent_Definition", () => {
  it("breaks no criterion", () => {
    expect(checkAgentDefinition(committedText, ROOT)).toEqual([]);
  });

  it("is the only Agent_Definition for medium outside spikes/", () => {
    const found: string[] = [];
    const skip = new Set(["node_modules", ".git", ".next", "spikes", ".graveyard-work"]);
    const walk = (dir: string, relative: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(join(dir, entry.name), `${relative}${entry.name}/`);
        } else if (entry.name.endsWith(".json") && relative.startsWith(".kiro/agents/")) {
          const parsed: unknown = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
          if (basename(entry.name, ".json") === "medium" || (isObject(parsed) && parsed["name"] === "medium")) {
            found.push(`${relative}${entry.name}`);
          }
        } else if (entry.name === "medium.json" && !relative.startsWith("tests/")) {
          found.push(`${relative}${entry.name}`);
        }
      }
    };
    walk(ROOT, "");
    expect(found).toEqual([".kiro/agents/medium.json"]);
  });

  it("has both steering files", () => {
    for (const resource of RESOURCES) expect(existsSync(join(ROOT, resource.slice("file://".length)))).toBe(true);
  });

  it("has a matcher that matches every Write_Tool name", () => {
    const def = JSON.parse(committedText) as Json;
    const matcher = new RegExp(hookOf(def)["matcher"] as string);
    expect(WRITE_TOOLS.length).toBeGreaterThan(0);
    for (const name of WRITE_TOOLS) expect(matcher.test(name), name).toBe(true);
  });
});

describe("the checker rejects single mutations", () => {
  it.each(MUTATIONS.map((m) => [m.criterion, m.name, m] as const))("%s: %s", (criterion, _name, mutation) => {
    const problems = checkAgentDefinition(mutation.text(), ROOT);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.startsWith(`Requirement ${criterion}:`))).toBe(true);
  });

  it("covers every criterion of the task", () => {
    const covered = new Set(MUTATIONS.map((m) => m.criterion));
    for (const criterion of ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "13.4"]) {
      expect(covered.has(criterion), criterion).toBe(true);
    }
  });
});
