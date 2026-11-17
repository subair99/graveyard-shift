// Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTAKE_LIMITS } from "../../../src/pipeline/common/constants";

const SERVER = resolve("src/pipeline/medium/agent/contextServer.mjs");
const MAX = INTAKE_LIMITS.maxFileBytes;
const NOT_ALLOWED = "path not found or not allowed";

interface Reply {
  jsonrpc?: string;
  id?: unknown;
  result?: any;
  error?: { code: number; message: string };
}

interface ServerRun {
  status: number | null;
  stdout: string;
  stderr: string;
  replies: Reply[];
}

function runServer(args: string[], lines: string[]): ServerRun {
  const r = spawnSync(process.execPath, [SERVER, ...args], {
    input: lines.map((l) => `${l}\n`).join(""),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const replies = r.stdout === "" ? [] : r.stdout.slice(0, -1).split("\n").map((l) => JSON.parse(l) as Reply);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, replies };
}

let base = "";
let ctx = "";
let bigCtx = "";
let linksSupported = false;

const CERTIFICATE = {
  vitalSigns: {
    openVulnerabilities: {
      available: true,
      value: [
        { id: "GHSA-1", aliases: ["CVE-1"], summary: "first", extra: "dropped" },
        { id: "GHSA-2", aliases: [], summary: "second" },
      ],
    },
  },
  facts: [
    { key: "other", provenance: [{ url: "https://example.invalid/other", fetchedAt: "2026-01-01" }] },
    { key: "openVulnerabilities", provenance: [{ url: "https://api.osv.dev/x", fetchedAt: "2026-05-01" }] },
  ],
};
const CERTIFICATE_TEXT = `${JSON.stringify(CERTIFICATE, null, 1)}\r\n`;
const ELIGIBILITY_TEXT = '{"eligible":true}  \n';
const MENU_TEXT = '{"presets":[]}\n';
const MEASUREMENT = { advisory: { sources: [{ url: "https://example.invalid/m", checkedOn: "2026-05-02" }] } };

function call(name: string, args?: unknown, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } });
}

function callOne(dir: string, name: string, args?: unknown): Reply {
  return runServer(["--context", dir], [call(name, args)]).replies[0]!;
}

function text(reply: Reply): string {
  return reply.result.content[0].text as string;
}

function makeContext(dir: string): void {
  mkdirSync(join(dir, "original", "lib"), { recursive: true });
  writeFileSync(join(dir, "certificate.json"), CERTIFICATE_TEXT);
  writeFileSync(join(dir, "eligibility.json"), ELIGIBILITY_TEXT);
  writeFileSync(join(dir, "preset-menu.json"), MENU_TEXT);
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "medium-ctxserver-it-")));
  ctx = join(base, "ctx");
  makeContext(ctx);
  writeFileSync(join(ctx, "original", "b.js"), "module.exports = 'é';\n");
  writeFileSync(join(ctx, "original", "a.txt"), "A");
  writeFileSync(join(ctx, "original", "lib", "z.js"), "zz");
  writeFileSync(join(ctx, "original", "bad.bin"), Buffer.from([0xff, 0xfe, 0x41]));
  writeFileSync(join(ctx, "original", "exact.txt"), Buffer.alloc(MAX, 0x61));
  writeFileSync(join(base, "outside.txt"), "SECRET");
  mkdirSync(join(base, "outsideDir"));
  writeFileSync(join(base, "outsideDir", "f.txt"), "SECRET");
  mkdirSync(join(ctx, "original", "emptydir"));

  try {
    symlinkSync(join(base, "outside.txt"), join(ctx, "original", "link-out.txt"), "file");
    symlinkSync(join(base, "outsideDir"), join(ctx, "original", "link-dir"), "dir");
    symlinkSync(join(ctx, "original", "a.txt"), join(ctx, "original", "link-in.txt"), "file");
    linksSupported = true;
  } catch {
    linksSupported = false;
  }

  bigCtx = join(base, "big");
  makeContext(bigCtx);
  const big = Buffer.alloc(MAX + 1, 0x61);
  writeFileSync(join(bigCtx, "certificate.json"), big);
  writeFileSync(join(bigCtx, "eligibility.json"), big);
  writeFileSync(join(bigCtx, "preset-menu.json"), big);
  writeFileSync(join(bigCtx, "original", "big.txt"), big);
});

afterAll(() => {
  if (base !== "") rmSync(base, { recursive: true, force: true });
});

describe("protocol and tool list", () => {
  it("answers initialize, ping and tools/list; sends nothing for notifications", () => {
    const run = runServer(
      ["--context", ctx],
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/other", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      ],
    );
    expect(run.status).toBe(0);
    expect(run.replies).toHaveLength(3);
    expect(run.replies.every((r) => r.jsonrpc === "2.0")).toBe(true);
    expect(run.replies[0]!.result.protocolVersion).toBe("2024-11-05");
    expect(run.replies[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    const tools = run.replies[2]!.result.tools as Array<{ name: string; inputSchema: any }>;
    expect(tools.map((t) => t.name)).toEqual([
      "get_certificate",
      "get_eligibility",
      "get_advisories",
      "list_original_files",
      "read_original_file",
      "get_preset_menu",
    ]);
    for (const t of tools) expect(t.inputSchema.additionalProperties).toBe(false);
    const read = tools.find((t) => t.name === "read_original_file")!;
    expect(read.inputSchema.required).toEqual(["path"]);
    expect(read.inputSchema.properties.path.type).toBe("string");
    for (const t of tools.filter((x) => x.name !== "read_original_file")) {
      expect(Object.keys(t.inputSchema.properties)).toEqual([]);
    }
  });

  it("falls back to a supported protocol version for an unknown one", () => {
    const run = runServer(
      ["--context", ctx],
      [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })],
    );
    expect(run.replies[0]!.result.protocolVersion).toBe("2025-06-18");
  });
});

describe("tool outputs", () => {
  it("returns certificate, eligibility and preset menu byte for byte", () => {
    expect(text(callOne(ctx, "get_certificate"))).toBe(CERTIFICATE_TEXT);
    expect(text(callOne(ctx, "get_eligibility"))).toBe(ELIGIBILITY_TEXT);
    expect(text(callOne(ctx, "get_preset_menu"))).toBe(MENU_TEXT);
    expect(callOne(ctx, "get_certificate").result.isError).toBeUndefined();
  });

  it("lists original files sorted by path with sizes", () => {
    const list = JSON.parse(text(callOne(ctx, "list_original_files"))) as Array<{ path: string; size: number }>;
    const paths = list.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
    expect(list.find((e) => e.path === "a.txt")!.size).toBe(1);
    expect(list.find((e) => e.path === "lib/z.js")!.size).toBe(2);
    expect(list.find((e) => e.path === "b.js")!.size).toBe(Buffer.byteLength("module.exports = 'é';\n"));
    expect(paths).toContain("bad.bin");
    expect(paths).not.toContain("emptydir");
  });

  it("reads an original file as text, including a nested one", () => {
    expect(text(callOne(ctx, "read_original_file", { path: "b.js" }))).toBe("module.exports = 'é';\n");
    expect(text(callOne(ctx, "read_original_file", { path: "lib/z.js" }))).toBe("zz");
  });

  it("get_advisories without measurement.json copies advisories and provenance, with no measurement key", () => {
    const out = JSON.parse(text(callOne(ctx, "get_advisories")));
    const prov = [{ url: "https://api.osv.dev/x", fetchedAt: "2026-05-01" }];
    expect(out).toEqual({
      available: true,
      advisories: [
        { id: "GHSA-1", aliases: ["CVE-1"], summary: "first", provenance: prov },
        { id: "GHSA-2", aliases: [], summary: "second", provenance: prov },
      ],
    });
    expect("measurement" in out).toBe(false);
  });

  it("get_advisories with measurement.json adds the user-checked measurement", () => {
    const dir = join(base, "with-measurement");
    makeContext(dir);
    writeFileSync(join(dir, "measurement.json"), JSON.stringify(MEASUREMENT));
    const out = JSON.parse(text(callOne(dir, "get_advisories")));
    expect(out.measurement).toEqual({ label: "user-checked", content: MEASUREMENT });
    expect(out.advisories).toHaveLength(2);
  });
});

describe("read_original_file containment (6.3)", () => {
  function expectNotAllowed(path: string): void {
    const reply = callOne(ctx, "read_original_file", { path });
    expect(reply.result.isError).toBe(true);
    expect(text(reply)).toBe(NOT_ALLOWED);
  }

  it("refuses .., absolute, NUL, missing and directory paths", () => {
    expectNotAllowed("../outside.txt");
    expectNotAllowed("lib/../../outside.txt");
    expectNotAllowed(join(base, "outside.txt"));
    expectNotAllowed("/etc/passwd");
    expectNotAllowed("C:\\Windows\\win.ini");
    expectNotAllowed("a.txt\0");
    expectNotAllowed("missing.txt");
    expectNotAllowed("lib");
    expectNotAllowed("");
  });

  it("refuses links that resolve outside original/ and follows links inside", (ctxt) => {
    if (!linksSupported) return ctxt.skip();
    expectNotAllowed("link-out.txt");
    expectNotAllowed("link-dir/f.txt");
    expect(text(callOne(ctx, "read_original_file", { path: "link-in.txt" }))).toBe("A");
  });
});

describe("size limit and UTF-8 (6.5)", () => {
  it("reads a file of exactly the limit", () => {
    expect(text(callOne(ctx, "read_original_file", { path: "exact.txt" })).length).toBe(MAX);
  });

  it("returns isError naming the size limit on each tool that reads a file, with none of the bytes", () => {
    const calls: Array<[string, unknown?]> = [
      ["get_certificate"],
      ["get_eligibility"],
      ["get_preset_menu"],
      ["get_advisories"],
      ["read_original_file", { path: "big.txt" }],
    ];
    for (const [name, args] of calls) {
      const reply = callOne(bigCtx, name, args);
      expect(reply.result.isError, name).toBe(true);
      const t = text(reply);
      expect(t, name).toMatch(/larger than 1048576 bytes/);
      expect(t.length, name).toBeLessThan(200);
      expect(t, name).not.toContain("aaaa");
    }
  });

  it("returns isError naming UTF-8 for an invalid file", () => {
    const reply = callOne(ctx, "read_original_file", { path: "bad.bin" });
    expect(reply.result.isError).toBe(true);
    expect(text(reply)).toBe("file is not valid UTF-8");
  });
});

describe("protocol errors (6.6), each followed by an answered valid request", () => {
  const PING = JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" });

  function expectErrorThenPing(line: string, code: number, id: unknown): Reply {
    const run = runServer(["--context", ctx], [line, PING]);
    expect(run.status).toBe(0);
    expect(run.replies).toHaveLength(2);
    expect(run.replies[0]!.jsonrpc).toBe("2.0");
    expect(run.replies[0]!.error!.code).toBe(code);
    expect(run.replies[0]!.id).toBe(id);
    expect(run.replies[1]).toEqual({ jsonrpc: "2.0", id: 99, result: {} });
    return run.replies[0]!;
  }

  it("invalid JSON gives -32700 with id null", () => {
    expectErrorThenPing("{not json", -32700, null);
  });

  it("valid JSON that is not a JSON-RPC 2.0 object gives -32600", () => {
    expectErrorThenPing("[1,2]", -32600, null);
    expectErrorThenPing("5", -32600, null);
    expectErrorThenPing(JSON.stringify({ id: 4, method: "ping" }), -32600, 4);
  });

  it("an unknown method gives -32601", () => {
    expectErrorThenPing(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "nope/nothing" }), -32601, 7);
  });

  it("an unknown tool gives -32602 Invalid params", () => {
    const e = expectErrorThenPing(call("delete_everything", {}, 8), -32602, 8);
    expect(e.error!.message).toBe("Invalid params");
  });

  it("arguments the schema rejects give -32602 Invalid params", () => {
    const bad: unknown[] = [
      "a string",
      [],
      null,
      {},
      { path: 5 },
      { path: "a.txt", extra: 1 },
    ];
    for (const args of bad) {
      const e = expectErrorThenPing(call("read_original_file", args, 9), -32602, 9);
      expect(e.error!.message).toBe("Invalid params");
    }
    expectErrorThenPing(call("get_certificate", { extra: true }, 10), -32602, 10);
  });

  it("a tool call without arguments for a no-property tool is answered", () => {
    expect(text(callOne(ctx, "get_eligibility"))).toBe(ELIGIBILITY_TEXT);
  });
});

describe("start failures (6.7)", () => {
  function expectStartFailure(args: string[]): void {
    const run = runServer(args, [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })]);
    expect(run.status).not.toBe(0);
    expect(run.status).not.toBeNull();
    expect(run.stdout).toBe("");
    expect(run.stderr.length).toBeGreaterThan(0);
  }

  it("fails without the argument pair", () => {
    expectStartFailure([]);
    expectStartFailure(["--context"]);
    expectStartFailure(["--other", ctx]);
  });

  it("fails when the path is missing or is not a directory", () => {
    expectStartFailure(["--context", join(base, "does-not-exist")]);
    expectStartFailure(["--context", join(ctx, "certificate.json")]);
  });

  it("resolves a relative directory against the repository root, not the working directory", () => {
    const r = spawnSync(process.execPath, [SERVER, "--context", "src/pipeline/medium/agent"], {
      input: `${call("get_certificate")}\n`,
      encoding: "utf8",
      cwd: base,
    });
    expect(r.status).toBe(0);
    const reply = JSON.parse(r.stdout.trim()) as Reply;
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toMatch(/^certificate\.json: /);
  });
});

describe("over-long line (6.8)", () => {
  it("exits non-zero with a reason on stderr and nothing on stdout", () => {
    const run = runServer(["--context", ctx], []);
    expect(run.status).toBe(0);
    const r = spawnSync(process.execPath, [SERVER, "--context", ctx], {
      input: "x".repeat(1048576 + 1024),
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBeNull();
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/too long/);
  });
});
