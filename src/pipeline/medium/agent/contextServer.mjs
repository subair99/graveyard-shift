// Context_Server: read-only stdio MCP server of the Medium agent (medium-agent design Component 4).
// Dependency-free ES module. Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout; log text goes to stderr only.
// Framing follows spikes/kiro-agent/mcp-stub/server.mjs. Started as: node contextServer.mjs --context <dir>.
// Imports only node:fs, node:path and node:url. Reads no environment variable. Offers no write, delete, rename,
// execute or fetch tool. `main` runs only when this file is the process entry, so tests can import the pure parts.
import { closeSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Equals INTAKE_LIMITS.maxFileBytes (src/pipeline/common/constants.ts); a unit test checks it. */
export const MAX_FILE_BYTES = 1048576;
/** The spike stub's MAX_LINE, a chosen value. */
export const MAX_LINE_BYTES = 1048576;
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2025-06-18", "2025-03-26", "2024-11-05"]);
export const NOT_ALLOWED_TEXT = "path not found or not allowed";

const NO_ARGUMENTS = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

export const TOOLS = Object.freeze([
  {
    name: "get_certificate",
    description: "Read-only. Returns the Death Certificate of the package as JSON text, unchanged.",
    inputSchema: NO_ARGUMENTS,
  },
  {
    name: "get_eligibility",
    description: "Read-only. Returns the Eligibility Record of the package as JSON text, unchanged.",
    inputSchema: NO_ARGUMENTS,
  },
  {
    name: "get_advisories",
    description:
      "Read-only. Returns JSON text with each open vulnerability of the certificate (id, aliases, summary, provenance) " +
      "and, when present, the user-checked measurement record under the key measurement.",
    inputSchema: NO_ARGUMENTS,
  },
  {
    name: "list_original_files",
    description: "Read-only. Returns a JSON array of {path, size} for every file of the original package, sorted by path.",
    inputSchema: NO_ARGUMENTS,
  },
  {
    name: "read_original_file",
    description: "Read-only. Returns the text of one file of the original package, named by its relative path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path of the file, as returned by list_original_files." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "get_preset_menu",
    description: "Read-only. Returns the menu of presets, delta kinds and CI-owned keys as JSON text, unchanged.",
    inputSchema: NO_ARGUMENTS,
  },
]);

// ---------------------------------------------------------------------------
// buildAdvisories (pure)
// ---------------------------------------------------------------------------

/**
 * @param {string} certificateText certificate.json text
 * @param {string | null} measurementText measurement.json text, or null when the file is absent
 * @returns {string} JSON text
 * @throws {Error} with a plain message when the inputs do not hold what the result needs
 */
export function buildAdvisories(certificateText, measurementText) {
  let certificate;
  try {
    certificate = JSON.parse(certificateText);
  } catch {
    throw new Error("certificate.json is not valid JSON");
  }
  let measurement = null;
  if (measurementText !== null) {
    try {
      measurement = { label: "user-checked", content: JSON.parse(measurementText) };
    } catch {
      throw new Error("measurement.json is not valid JSON");
    }
    addFetchedAt(measurement.content);
  }
  const open = isObject(certificate) && isObject(certificate.vitalSigns) ? certificate.vitalSigns.openVulnerabilities : undefined;
  if (!isObject(open) || typeof open.available !== "boolean") {
    throw new Error("certificate has no openVulnerabilities vital sign");
  }
  /** @type {Record<string, unknown>} */
  const result = {};
  if (!open.available) {
    result.available = false;
    result.reason = open.reason;
  } else {
    const fact = Array.isArray(certificate.facts)
      ? certificate.facts.find((f) => isObject(f) && f.key === "openVulnerabilities")
      : undefined;
    if (fact === undefined || !Array.isArray(fact.provenance) || !Array.isArray(open.value)) {
      throw new Error("certificate has no openVulnerabilities fact");
    }
    result.available = true;
    result.advisories = open.value.map((v) => ({
      id: v.id,
      aliases: v.aliases,
      summary: v.summary,
      provenance: fact.provenance,
    }));
  }
  if (measurement !== null) result.measurement = measurement;
  return JSON.stringify(result, null, 2);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True for a real calendar date written YYYY-MM-DD. */
function isDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** True for a real UTC instant written YYYY-MM-DDTHH:mm:ssZ (the Fetch_Date format of UtcTimestampSchema). */
function isFetchDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value.replace("Z", ".000Z");
}

/** Adds fetchedAt (and fetchedAtPrecision for a date-only value) to each content.advisory.sources entry, in place. */
function addFetchedAt(content) {
  if (!isObject(content) || !isObject(content.advisory) || content.advisory.sources === undefined) return;
  const sources = content.advisory.sources;
  if (!Array.isArray(sources)) throw new Error("measurement.json advisory.sources is not a list");
  for (const source of sources) {
    const on = isObject(source) ? source.checkedOn : undefined;
    if (typeof on === "string" && isDateOnly(on)) {
      source.fetchedAt = `${on}T00:00:00Z`;
      source.fetchedAtPrecision = "date-only";
    } else if (typeof on === "string" && isFetchDate(on)) {
      source.fetchedAt = on;
    } else {
      throw new Error("measurement.json advisory source checkedOn is not a valid date (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)");
    }
  }
}

// ---------------------------------------------------------------------------
// File reading (read-only)
// ---------------------------------------------------------------------------

/** @returns {{ok: true, bytes: Buffer} | {ok: false, reason: string}} */
function readBounded(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, reason: NOT_ALLOWED_TEXT };
    if (st.size > MAX_FILE_BYTES) return { ok: false, reason: `file larger than ${MAX_FILE_BYTES} bytes` };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { ok: true, bytes: buf.subarray(0, off) };
  } catch (err) {
    return { ok: false, reason: `read failed: ${String((err && err.code) || "error")}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

function createTools(contextDir) {
  const contextFile = (name) => {
    const r = readBounded(resolve(contextDir, name));
    return r.ok ? { ok: true, text: r.bytes.toString("utf8") } : { ok: false, text: `${name}: ${r.reason}` };
  };

  function listOriginal() {
    let root;
    try {
      root = realpathSync(resolve(contextDir, "original"));
    } catch {
      return { ok: false, text: "original files not available" };
    }
    const out = [];
    const walk = (dir, prefix) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full, rel);
        else if (entry.isFile()) out.push({ path: rel, size: statSync(full).size });
      }
    };
    try {
      walk(root, "");
    } catch {
      return { ok: false, text: "original files not available" };
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { ok: true, text: JSON.stringify(out) };
  }

  function readOriginal(requested) {
    const bad = { ok: false, text: NOT_ALLOWED_TEXT };
    if (requested.includes("\0")) return bad;
    if (requested.startsWith("/") || requested.startsWith("\\") || /^[A-Za-z]:/.test(requested) || isAbsolute(requested)) {
      return bad;
    }
    let real;
    try {
      const root = realpathSync(resolve(contextDir, "original"));
      real = realpathSync(resolve(root, requested));
      if (!isInside(root, real)) return bad;
    } catch {
      return bad;
    }
    const r = readBounded(real);
    if (!r.ok) return { ok: false, text: r.reason };
    try {
      return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(r.bytes) };
    } catch {
      return { ok: false, text: "file is not valid UTF-8" };
    }
  }

  function advisories() {
    const cert = contextFile("certificate.json");
    if (!cert.ok) return cert;
    let measurementText = null;
    const m = readBounded(resolve(contextDir, "measurement.json"));
    if (m.ok) measurementText = m.bytes.toString("utf8");
    else if (!/ENOENT|ENOTDIR/.test(m.reason)) return { ok: false, text: `measurement.json: ${m.reason}` };
    try {
      return { ok: true, text: buildAdvisories(cert.text, measurementText) };
    } catch (err) {
      return { ok: false, text: String((err && err.message) || "advisories unavailable") };
    }
  }

  return {
    get_certificate: () => contextFile("certificate.json"),
    get_eligibility: () => contextFile("eligibility.json"),
    get_advisories: advisories,
    list_original_files: listOriginal,
    read_original_file: (args) => readOriginal(args.path),
    get_preset_menu: () => contextFile("preset-menu.json"),
  };
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

function send(msg) {
  // One JSON object per line; JSON.stringify never emits a raw newline.
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function rpcError(id, code, message) {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/** Returns an error message when `args` does not satisfy the input schema of `tool`, else null. */
function argumentProblem(tool, args) {
  if (!isObject(args)) return "arguments must be an object";
  const allowed = Object.keys(tool.inputSchema.properties);
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) return "additional property";
  }
  for (const key of tool.inputSchema.required ?? []) {
    if (typeof args[key] !== "string") return "missing or non-string property";
  }
  return null;
}

function createHandler(contextDir) {
  const impl = createTools(contextDir);
  return function handle(msg) {
    if (!isObject(msg) || msg.jsonrpc !== "2.0") return rpcError(isObject(msg) ? msg.id : null, -32600, "Invalid Request");
    const { id, method, params } = msg;
    const isNotification = id === undefined;
    if (typeof method !== "string") return; // a response from the client: this server sends no requests
    switch (method) {
      case "initialize": {
        if (isNotification) return;
        const asked = isObject(params) ? params.protocolVersion : undefined;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
        return send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "medium-context", version: "1.0.0" },
          },
        });
      }
      case "ping":
        return isNotification ? undefined : send({ jsonrpc: "2.0", id, result: {} });
      case "tools/list":
        if (isNotification) return;
        return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      case "tools/call": {
        if (isNotification) return;
        const tool = isObject(params) ? TOOLS.find((t) => t.name === params.name) : undefined;
        if (tool === undefined) return rpcError(id, -32602, "Invalid params");
        const args = params.arguments === undefined ? {} : params.arguments;
        if (argumentProblem(tool, args) !== null) return rpcError(id, -32602, "Invalid params");
        const out = impl[tool.name](args);
        const result = { content: [{ type: "text", text: out.text }] };
        if (!out.ok) result.isError = true;
        return send({ jsonrpc: "2.0", id, result });
      }
      default:
        // Notifications (notifications/initialized and any other) get no response.
        if (isNotification) return;
        return rpcError(id, -32601, "Method not found");
    }
  };
}

function startFailure(reason) {
  process.stderr.write(`context-server: ${reason}\n`);
  process.exit(1);
}

function resolveContextDir(argv) {
  if (argv.length !== 2 || argv[0] !== "--context" || argv[1] === "") {
    return startFailure("usage: contextServer.mjs --context <dir>");
  }
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const candidate = resolve(repoRoot, argv[1]);
  try {
    const real = realpathSync(candidate);
    if (!statSync(real).isDirectory()) return startFailure("context path is not a directory");
    readdirSync(real);
    return real;
  } catch {
    return startFailure("context path is not a readable directory");
  }
}

function main() {
  const contextDir = resolveContextDir(process.argv.slice(2));
  const handle = createHandler(contextDir);

  const onLine = (lineBuffer) => {
    const line = lineBuffer.toString("utf8");
    if (line.trim() === "") return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return rpcError(null, -32700, "Parse error");
    }
    try {
      handle(msg);
    } catch {
      process.stderr.write("context-server: internal error\n");
      rpcError(isObject(msg) ? msg.id : null, -32603, "Internal error");
    }
  };

  let pending = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    let nl;
    while ((nl = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, nl);
      pending = pending.subarray(nl + 1);
      if (line.length > MAX_LINE_BYTES) {
        process.stderr.write("context-server: line too long; exiting\n");
        process.exit(1);
      }
      onLine(line);
    }
    if (pending.length > MAX_LINE_BYTES) {
      process.stderr.write("context-server: line too long; exiting\n");
      process.exit(1);
    }
  });
  process.stdin.on("end", () => {
    process.exitCode = 0;
  });
}

function isProcessEntry() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isProcessEntry()) main();
