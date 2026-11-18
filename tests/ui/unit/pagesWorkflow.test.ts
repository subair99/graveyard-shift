/**
 * Pages_Workflow lint (task 11.3). Parses `.github/workflows/pages.yml` with the `yaml` package and reports rule
 * violations as text; the real file has none, and each rule is shown to fire on a mutated copy of the parsed file.
 */
// Requirements: 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.10, 9.11, 9.12, 10.5, 11.4
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PINNED_NODE_VERSION } from "../../../src/pipeline/common/constants";

const file = resolve(__dirname, "..", "..", "..", ".github", "workflows", "pages.yml");

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
}
interface Job {
  if?: string;
  needs?: string;
  permissions?: Record<string, string>;
  "timeout-minutes"?: number;
  env?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on?: {
    push?: { branches?: string[]; paths?: string[] };
    workflow_run?: { workflows?: string[]; types?: string[] };
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
}

const PINS: Record<string, { sha: string; version: string }> = {
  "actions/configure-pages": { sha: "45bfe0192ca1faeb007ade9deae92b16b8254a0d", version: "v6.0.0" },
  "actions/upload-pages-artifact": { sha: "fc324d3547104276b827a68afc52ff2a11cc49c9", version: "v5.0.0" },
  "actions/deploy-pages": { sha: "368f82528645a54fb793d4d04e342629a3f51346", version: "v5.0.1" },
};

const REQUIRED_PATHS = [
  "graveyard/**",
  "ledger.json",
  "src/app/**",
  "src/ui/**",
  "scripts/ui/**",
  "next.config.mjs",
  "package.json",
  "package-lock.json",
  ".github/workflows/pages.yml",
];

const text = readFileSync(file, "utf8");
const real = parse(text) as Workflow;

/** Event context: flat map of the `github.*` names the `if:` expression may read. */
interface Ctx {
  event_name: string;
  run?: { name: string; head_branch: string; repo: string; event: string };
}

/** Evaluates the `if:` expression (only ==, ||, &&, parentheses, quoted strings and `github.*` names). */
function evalIf(expr: string, ctx: Ctx): boolean {
  const values: Record<string, string | undefined> = {
    "github.event_name": ctx.event_name,
    "github.repository": "owner/repo",
    "github.event.workflow_run.name": ctx.run?.name,
    "github.event.workflow_run.head_branch": ctx.run?.head_branch,
    "github.event.workflow_run.head_repository.full_name": ctx.run?.repo,
    "github.event.workflow_run.event": ctx.run?.event,
  };
  const js = expr.replace(/\bgithub(?:\.[A-Za-z_]+)+/g, (n) => `g(${JSON.stringify(n)})`);
  if (/[^\s\w()'"=|&.,-]/.test(js.replace(/g\("[^"]*"\)/g, ""))) throw new Error(`unsupported expression: ${expr}`);
  const g = (n: string): string | undefined => {
    if (!(n in values)) throw new Error(`unknown context name ${n}`);
    return values[n];
  };
  return Boolean(new Function("g", `return (${js});`)(g));
}

const GOOD_RUN = { name: "nightly", head_branch: "main", repo: "owner/repo", event: "schedule" };
const runCtx = (over: Partial<typeof GOOD_RUN> = {}): Ctx => ({ event_name: "workflow_run", run: { ...GOOD_RUN, ...over } });

function actionsOf(doc: Workflow): { job: string; step: Step }[] {
  return Object.entries(doc.jobs ?? {}).flatMap(([job, j]) => (j.steps ?? []).map((step) => ({ job, step })));
}

/** Returns one line per violation. */
function lintPages(doc: Workflow, src: string): string[] {
  const out: string[] = [];
  const on = doc.on ?? {};
  const jobs = doc.jobs ?? {};
  const build = jobs["build"];
  const deploy = jobs["deploy"];

  // workflow_run path
  if (!on.workflow_run) out.push("no workflow_run trigger");
  else {
    if (JSON.stringify(on.workflow_run.workflows) !== JSON.stringify(["nightly"])) out.push("workflow_run does not name only workflow nightly");
    if (JSON.stringify(on.workflow_run.types) !== JSON.stringify(["completed"])) out.push("workflow_run types is not [completed]");
  }
  // push / workflow_dispatch path
  if (!on.push) out.push("no push trigger");
  else {
    if (JSON.stringify(on.push.branches) !== JSON.stringify(["main"])) out.push("push is not limited to branch main");
    for (const p of REQUIRED_PATHS) if (!(on.push.paths ?? []).includes(p)) out.push(`push paths lack ${p}`);
    for (const p of on.push.paths ?? []) if (!REQUIRED_PATHS.includes(p)) out.push(`push paths has unexpected ${p}`);
  }
  if (!("workflow_dispatch" in on)) out.push("no workflow_dispatch trigger");
  for (const k of Object.keys(on)) if (!["push", "workflow_run", "workflow_dispatch"].includes(k)) out.push(`unexpected trigger ${k}`);

  // permissions
  if (JSON.stringify(doc.permissions) !== "{}") out.push("workflow permissions is not {}");
  if (!build || JSON.stringify(build.permissions) !== JSON.stringify({ contents: "read", actions: "read" })) out.push("build permissions is not contents read + actions read");
  if (!deploy || JSON.stringify(deploy.permissions) !== JSON.stringify({ pages: "write", "id-token": "write" })) out.push("deploy permissions is not pages write + id-token write");
  if (Object.keys(jobs).sort().join() !== "build,deploy") out.push("jobs are not build and deploy");
  for (const [n, j] of Object.entries(jobs)) {
    if (typeof j["timeout-minutes"] !== "number") out.push(`job ${n}: no timeout-minutes`);
    if (n !== "build" && n !== "deploy") out.push(`job ${n}: unexpected`);
  }

  // build condition
  if (build?.if === undefined) out.push("build has no if");
  else {
    const cond = build.if;
    if (/conclusion/.test(cond)) out.push("build if mentions conclusion");
    const checks: [string, Ctx, boolean][] = [
      ["push", { event_name: "push" }, true],
      ["workflow_dispatch", { event_name: "workflow_dispatch" }, true],
      ["pull_request", { event_name: "pull_request" }, false],
      ["nightly schedule run", runCtx(), true],
      ["nightly dispatch run", runCtx({ event: "workflow_dispatch" }), true],
      ["other workflow", runCtx({ name: "ci" }), false],
      ["other branch", runCtx({ head_branch: "dev" }), false],
      ["fork repository", runCtx({ repo: "fork/repo" }), false],
      ["nightly push run", runCtx({ event: "push" }), false],
      ["nightly pull_request run", runCtx({ event: "pull_request" }), false],
    ];
    for (const [label, ctx, want] of checks) {
      let got: boolean | string;
      try {
        got = evalIf(cond, ctx);
      } catch (e) {
        got = String(e);
      }
      if (got !== want) out.push(`build if for ${label}: expected ${want}, got ${String(got)}`);
    }
  }

  // build steps
  const steps = build?.steps ?? [];
  const download = steps.find((s) => s.uses?.startsWith("actions/download-artifact@"));
  const record = steps.find((s) => (s.run ?? "").includes("writeNightlyRun"));
  if (!download) out.push("no download step");
  else {
    if (download.if === undefined) out.push("download has no if");
    else {
      if (!evalIf(download.if, runCtx())) out.push("download if is false on workflow_run");
      for (const ev of ["push", "workflow_dispatch"]) {
        if (evalIf(download.if, { event_name: ev })) out.push(`download if is true on ${ev}`);
      }
    }
    if (download.with?.["name"] !== "nightly-report") out.push("download name is not nightly-report");
    if (download.with?.["run-id"] !== "${{ github.event.workflow_run.id }}") out.push("download run-id is not from the event");
    if (download.with?.["github-token"] !== "${{ github.token }}") out.push("download github-token is not github.token");
    if (download.with && "digest-mismatch" in download.with) out.push("download sets digest-mismatch");
    if (download["continue-on-error"] !== true) out.push("download has no continue-on-error");
  }
  if (!record) out.push("no run record step");
  else {
    const dependsOnDownload = /steps\.|success\(\)|failure\(\)|always\(\)|cancelled\(\)/.test(record.if ?? "");
    if (dependsOnDownload) out.push("run record depends on the download outcome");
    else {
      if (record.if === undefined || !evalIf(record.if, runCtx())) out.push("run record does not run on workflow_run");
      for (const ev of ["push", "workflow_dispatch"]) {
        if (record.if !== undefined && evalIf(record.if, { event_name: ev })) out.push(`run record runs on ${ev}`);
      }
    }
    if (!(record.env?.["GS_CONCLUSION"] ?? "").includes("github.event.workflow_run.conclusion")) out.push("run record lacks GS_CONCLUSION");
  }

  // actions pins and versions
  for (const [name, pin] of Object.entries(PINS)) {
    const line = src.split("\n").find((l) => l.includes(`uses: ${name}@`));
    if (line === undefined) out.push(`${name} not used`);
    else if (line.trim() !== `- uses: ${name}@${pin.sha} # ${pin.version}` && line.trim() !== `uses: ${name}@${pin.sha} # ${pin.version}`) out.push(`${name} pin or version comment differs`);
    if (!actionsOf(doc).some(({ step }) => step.uses === `${name}@${pin.sha}`)) out.push(`${name} parsed pin differs`);
  }

  // node, telemetry
  const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
  if (String(setup?.with?.["node-version"]) !== PINNED_NODE_VERSION) out.push("node-version is not PINNED_NODE_VERSION");
  if (!steps.some((s) => (s.run ?? "").includes(`v${PINNED_NODE_VERSION}`))) out.push("no Node version check step for the pinned version");
  if (build?.env?.["NEXT_TELEMETRY_DISABLED"] !== "1") out.push("NEXT_TELEMETRY_DISABLED is not 1 in build");

  // secrets and event values
  for (const m of src.matchAll(/secrets\.\w+/g)) out.push(`uses ${m[0]}`);
  for (const { job, step } of actionsOf(doc)) {
    if ((step.run ?? "").includes("${{")) out.push(`job ${job}: expression inside run: ${step.run}`);
  }
  return out;
}

const clone = (): Workflow => structuredClone(real);
const buildOf = (d: Workflow): Job => d.jobs!["build"]!;
const stepOf = (d: Workflow, pred: (s: Step) => boolean): Step => buildOf(d).steps!.find(pred)!;

describe("pages.yml", () => {
  it("has no violations", () => {
    expect(lintPages(real, text)).toEqual([]);
  });

  it("evaluates the build condition on both paths", () => {
    const cond = buildOf(real).if!;
    expect(evalIf(cond, { event_name: "push" })).toBe(true);
    expect(evalIf(cond, { event_name: "workflow_dispatch" })).toBe(true);
    expect(evalIf(cond, runCtx())).toBe(true);
    expect(evalIf(cond, runCtx({ head_branch: "dev" }))).toBe(false);
  });

  it("uses Node PINNED_NODE_VERSION and no event expression in any run: script", () => {
    expect(String(stepOf(real, (s) => s.uses?.startsWith("actions/setup-node@") === true).with?.["node-version"])).toBe(PINNED_NODE_VERSION);
    for (const { step } of actionsOf(real)) expect(step.run ?? "").not.toContain("${{");
  });
});

describe("pages.yml lint bites", () => {
  const mutations: [string, (d: Workflow) => void, RegExp][] = [
    ["workflow permission added", (d) => void (d.permissions = { contents: "read" }), /workflow permissions/],
    ["build write permission", (d) => void (buildOf(d).permissions!["contents"] = "write"), /build permissions/],
    ["build extra permission", (d) => void (buildOf(d).permissions!["id-token"] = "write"), /build permissions/],
    ["deploy extra permission", (d) => void (d.jobs!["deploy"]!.permissions!["contents"] = "read"), /deploy permissions/],
    ["conclusion condition added", (d) => void (buildOf(d).if += " && github.event.workflow_run.conclusion == 'success'"), /conclusion/],
    ["branch guard dropped", (d) => void (buildOf(d).if = buildOf(d).if!.replace("github.event.workflow_run.head_branch == 'main' &&", "")), /other branch/],
    ["repository guard dropped", (d) => void (buildOf(d).if = buildOf(d).if!.replace(/github\.event\.workflow_run\.head_repository\.full_name == github\.repository &&/, "")), /fork repository/],
    ["event guard dropped", (d) => void (buildOf(d).if = buildOf(d).if!.replace(/&&\s*\(github\.event\.workflow_run\.event[^)]*\)/, "")), /nightly push run/],
    ["push dropped from if", (d) => void (buildOf(d).if = buildOf(d).if!.replace("github.event_name == 'push' ||", "")), /for push/],
    ["download runs on push", (d) => void (stepOf(d, (s) => s.id === "nightly").if = undefined), /download has no if/],
    ["download if always true", (d) => void (stepOf(d, (s) => s.id === "nightly").if = "true || github.event_name == 'workflow_run'"), /download if is true on push/],
    ["wrong artifact name", (d) => void (stepOf(d, (s) => s.id === "nightly").with!["name"] = "other"), /download name/],
    ["digest-mismatch set", (d) => void (stepOf(d, (s) => s.id === "nightly").with!["digest-mismatch"] = "warn"), /digest-mismatch/],
    ["continue-on-error dropped", (d) => void (stepOf(d, (s) => s.id === "nightly")["continue-on-error"] = false), /continue-on-error/],
    ["run record gated on download", (d) => void (stepOf(d, (s) => (s.run ?? "").includes("writeNightlyRun")).if = "github.event_name == 'workflow_run' && steps.nightly.outcome == 'success'"), /download outcome|download step/],
    ["run record on push", (d) => void (stepOf(d, (s) => (s.run ?? "").includes("writeNightlyRun")).if = undefined), /run record/],
    ["push branch widened", (d) => void (d.on!.push!.branches = ["main", "dev"]), /branch main/],
    ["push path dropped", (d) => void (d.on!.push!.paths = d.on!.push!.paths!.filter((p) => p !== "ledger.json")), /ledger\.json/],
    ["workflow_dispatch dropped", (d) => void delete d.on!.workflow_dispatch, /workflow_dispatch trigger/],
    ["workflow_run types changed", (d) => void (d.on!.workflow_run!.types = ["requested"]), /types/],
    ["node version differs", (d) => void (stepOf(d, (s) => s.uses?.startsWith("actions/setup-node@") === true).with!["node-version"] = "22.0.0"), /node-version/],
    ["telemetry removed", (d) => void delete buildOf(d).env!["NEXT_TELEMETRY_DISABLED"], /TELEMETRY/],
    ["timeout removed", (d) => void delete d.jobs!["deploy"]!["timeout-minutes"], /timeout/],
    ["event value in run", (d) => void (stepOf(d, (s) => (s.run ?? "").includes("writeNightlyRun")).run = "echo ${{ github.event.workflow_run.head_sha }}"), /expression inside run/],
    ["pin changed", (d) => void (d.jobs!["deploy"]!.steps![0]!.uses = "actions/configure-pages@" + "0".repeat(40)), /configure-pages parsed pin/],
  ];
  for (const [label, mutate, expected] of mutations) {
    it(label, () => {
      const d = clone();
      mutate(d);
      const found = lintPages(d, text);
      expect(found.length).toBeGreaterThan(0);
      expect(found.join("\n")).toMatch(expected);
    });
  }

  it("fires on a changed version comment and on a secret", () => {
    expect(lintPages(real, text.replace("# v5.0.1", "# v5.0.0")).join("\n")).toMatch(/deploy-pages pin or version/);
    expect(lintPages(real, `${text}\n# ${"$"}{{ secrets.TOKEN }}`).join("\n")).toMatch(/secrets\.TOKEN/);
  });
});

/**
 * ci.yml job `site` (task 12.1, crypt-ui Requirement 10.5): the build check of the Crypt_Site.
 */
describe("ci.yml job site", () => {
  const ciText = readFileSync(resolve(__dirname, "..", "..", "..", ".github", "workflows", "ci.yml"), "utf8");
  const ci = parse(ciText) as Workflow;
  const site = ci.jobs?.["site"];
  const steps = site?.steps ?? [];

  it("exists next to the other jobs and leaves workflow permissions at contents read", () => {
    expect(Object.keys(ci.jobs ?? {})).toEqual(["test-linux", "test-no-identity", "test-windows", "site"]);
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(site?.permissions).toBeUndefined();
    expect(typeof site?.["timeout-minutes"]).toBe("number");
  });

  it("uses the same pinned checkout and setup-node as the other jobs", () => {
    const others = ["test-linux", "test-no-identity", "test-windows"].map((n) => (ci.jobs?.[n]?.steps ?? []).map((s) => s.uses ?? "").filter((u) => /^actions\/(checkout|setup-node)@/.test(u)));
    const mine = steps.map((s) => s.uses ?? "").filter((u) => /^actions\/(checkout|setup-node)@/.test(u));
    expect(mine).toHaveLength(2);
    for (const o of others) expect(o).toEqual(mine);
  });

  it("runs on Node PINNED_NODE_VERSION with a version check step", () => {
    const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(String(setup?.with?.["node-version"])).toBe(PINNED_NODE_VERSION);
    expect(steps.some((s) => (s.run ?? "").includes(`v${PINNED_NODE_VERSION}`))).toBe(true);
  });

  it("disables telemetry, builds, then runs the Site_Check_Script, in that order", () => {
    expect(site?.env?.["NEXT_TELEMETRY_DISABLED"]).toBe("1");
    const runs = steps.map((s) => s.run ?? "");
    const ci_ = runs.indexOf("npm ci");
    const build = runs.indexOf("npm run build");
    const check = runs.indexOf("node scripts/ui/checkSite.mjs");
    expect(ci_).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(ci_);
    expect(check).toBeGreaterThan(build);
  });

  it("uses no secrets and no GitHub expression in a run: script", () => {
    expect(JSON.stringify(site)).not.toMatch(/secrets\./);
    for (const s of steps) expect(s.run ?? "").not.toContain("${{");
  });
});
