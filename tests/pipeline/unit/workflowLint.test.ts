/**
 * Workflow lint (task 8.18). Parses every `.github/workflows/*.yml` with the `yaml` package and reports
 * rule violations as text; the real files must have none, and each rule is shown to fire on a small bad file.
 */
// Requirements: 9.13, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 11.14, 11.18, 12.6, 12.8, 12.12, 13.5, 15.12, 15.13
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PINNED_NODE_VERSION, PREDICATE_TYPE } from "../../../src/pipeline/common/constants";

const workflowDir = resolve(__dirname, "..", "..", "..", ".github", "workflows");

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string | string[];
  permissions?: Record<string, string>;
  "timeout-minutes"?: number;
  steps?: Step[];
}
interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, Job>;
}
interface WorkflowFile {
  name: string;
  text: string;
  doc: Workflow;
}

const SHA_REF = /^[^@\s]+@[0-9a-f]{40}$/;
/** The two workflows of this pipeline; the pin, the checkout and the `run:` rules apply to them only. */
const PIPELINE_FILES = new Set(["resurrect.yml", "nightly.yml"]);

function loadWorkflows(): WorkflowFile[] {
  return readdirSync(workflowDir)
    .filter((n) => n.endsWith(".yml"))
    .sort()
    .map((name) => {
      const text = readFileSync(join(workflowDir, name), "utf8");
      return { name, text, doc: parse(text) as Workflow };
    });
}

function needsOf(job: Job): string[] {
  return job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
}

function jobTouchesMedium(job: Job): boolean {
  return (job.steps ?? []).some((s) => (s.run ?? "").includes("scripts/ci/prove.ts") || (s.run ?? "").includes("work/medium"));
}

/** Returns one line per violation. */
export function lintWorkflows(files: readonly WorkflowFile[]): string[] {
  const out: string[] = [];
  const pins: { file: string; value: string }[] = [];
  for (const f of files) {
    const pipeline = PIPELINE_FILES.has(f.name);
    for (const m of f.text.matchAll(/secrets\.(?!GITHUB_TOKEN\b)\w+/g)) out.push(`${f.name}: ${m[0]} is not the workflow token`);
    if (f.text.includes("--radius")) out.push(`${f.name}: contains --radius`);
    if (f.text.includes(PREDICATE_TYPE)) out.push(`${f.name}: contains the predicate type`);
    for (const [jobName, job] of Object.entries(f.doc.jobs ?? {})) {
      const where = `${f.name} job ${jobName}`;
      if (typeof job["timeout-minutes"] !== "number") out.push(`${where}: no timeout-minutes`);
      const perms = job.permissions ?? {};
      if ((perms["id-token"] === "write" || perms["attestations"] === "write") && jobTouchesMedium(job)) {
        out.push(`${where}: id-token or attestations write in a job that runs prove or touches work/medium`);
      }
      for (const step of job.steps ?? []) {
        if (step.uses !== undefined && !step.uses.startsWith("./") && !SHA_REF.test(step.uses)) {
          out.push(`${where}: ${step.uses} is not pinned to a 40-hex SHA`);
        }
        if (step.uses?.startsWith("actions/checkout@") && step.with?.["persist-credentials"] !== false && pipeline) {
          out.push(`${where}: checkout without persist-credentials: false`);
        }
        if (step.uses?.startsWith("actions/setup-node@") && pipeline) {
          pins.push({ file: f.name, value: String(step.with?.["node-version"]) });
        }
        if (pipeline && step.run?.includes("${{")) out.push(`${where}: an expression inside a run: string`);
      }
      if (f.name === "resurrect.yml" && (jobName === "attest" || jobName === "publish") && !needsOf(job).includes("checks")) {
        out.push(`${where}: checks is not in needs`);
      }
    }
  }
  for (const p of pins) {
    if (!/^\d+\.\d+\.\d+$/.test(p.value)) out.push(`${p.file}: node-version ${p.value} is not major.minor.patch`);
    else if (p.value !== PINNED_NODE_VERSION) out.push(`${p.file}: node-version ${p.value} differs from ${PINNED_NODE_VERSION}`);
  }
  return out;
}

function wf(name: string, text: string): WorkflowFile {
  return { name, text, doc: parse(text) as Workflow };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const goodResurrect = `
on: { workflow_dispatch: {} }
jobs:
  checks:
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA}
        with: { persist-credentials: false }
      - uses: actions/setup-node@${SHA}
        with: { node-version: ${PINNED_NODE_VERSION} }
  attest:
    needs: [checks]
    timeout-minutes: 5
    steps: [{ run: "echo ok" }]
  publish:
    needs: [checks]
    timeout-minutes: 5
    steps: [{ run: "echo ok" }]
`;

describe("workflow lint", () => {
  it("finds no violation in the repository workflows", () => {
    expect(lintWorkflows(loadWorkflows())).toEqual([]);
  });

  it("has resurrect.yml with the five jobs and an empty workflow-level permissions block", () => {
    const resurrect = loadWorkflows().find((f) => f.name === "resurrect.yml");
    expect(resurrect).toBeDefined();
    expect(Object.keys(resurrect?.doc.jobs ?? {})).toEqual(["intake", "checks", "prove", "attest", "publish"]);
    expect((resurrect?.doc as { permissions?: unknown }).permissions).toEqual({});
  });

  it("binds attest to the digests that intake emits as job outputs (V16)", () => {
    const resurrect = loadWorkflows().find((f) => f.name === "resurrect.yml");
    const jobs = (resurrect?.doc.jobs ?? {}) as Record<string, Job & { outputs?: Record<string, string>; env?: Record<string, string> }>;
    expect(jobs["intake"]?.outputs?.["certificate_digest"]).toBe("${{ steps.coroner.outputs.certificate_digest }}");
    expect(jobs["intake"]?.outputs?.["tarball_digest"]).toBe("${{ steps.pack.outputs.tarball_digest }}");
    const prepare = (jobs["attest"]?.steps ?? []).find((s) => (s.run ?? "").includes("attest.ts prepare")) as
      | (Step & { env?: Record<string, string> })
      | undefined;
    expect(prepare?.env?.["GS_INTAKE_SHA256_TARBALL"]).toBe("${{ needs.intake.outputs.tarball_digest }}");
    expect(prepare?.env?.["GS_INTAKE_SHA256_CERTIFICATE"]).toBe("${{ needs.intake.outputs.certificate_digest }}");
    expect(needsOf(jobs["attest"] as Job)).toContain("intake");
    // prove uploads under its own name, never intake-data, and without overwrite
    const uploads = (jobs["prove"]?.steps ?? []).filter((s) => (s.uses ?? "").startsWith("actions/upload-artifact@"));
    expect(uploads.map((s) => s.with?.["name"])).toEqual(["prove-data"]);
    expect(uploads.every((s) => s.with?.["overwrite"] === undefined)).toBe(true);
  });

  it("asserts ci.yml has workflow_dispatch", () => {
    const ci = loadWorkflows().find((f) => f.name === "ci.yml");
    expect(ci?.doc.on).toHaveProperty("workflow_dispatch");
  });

  it("accepts a good file", () => {
    expect(lintWorkflows([wf("resurrect.yml", goodResurrect)])).toEqual([]);
  });

  it.each([
    ["a tag instead of a SHA", goodResurrect.replace(`checkout@${SHA}`, "checkout@v7"), "not pinned"],
    ["a missing timeout", goodResurrect.replace("  publish:\n    needs: [checks]\n    timeout-minutes: 5", "  publish:\n    needs: [checks]"), "no timeout-minutes"],
    ["checkout credentials kept", goodResurrect.replace("{ persist-credentials: false }", "{ fetch-depth: 0 }"), "persist-credentials"],
    ["a non-patch Node version", goodResurrect.replace(`node-version: ${PINNED_NODE_VERSION}`, "node-version: 26"), "major.minor.patch"],
    ["another Node version", goodResurrect.replace(`node-version: ${PINNED_NODE_VERSION}`, "node-version: 26.0.0"), "differs"],
    ["publish without checks", goodResurrect.replace("  publish:\n    needs: [checks]", "  publish:\n    needs: []"), "checks is not in needs"],
    ["a secret", goodResurrect.replace('echo ok" }]\n  publish', 'echo ${{ secrets.NPM_TOKEN }}" }]\n  publish'), "secrets.NPM_TOKEN"],
    ["an expression in run", goodResurrect.replace('"echo ok" }]\n  publish', '"echo ${{ inputs.package }}" }]\n  publish'), "expression inside a run"],
    ["--radius", goodResurrect.replace('"echo ok" }]\n  publish', '"x --radius 3" }]\n  publish'), "--radius"],
    [
      "attest permissions next to prove",
      goodResurrect.replace(
        "  attest:\n    needs: [checks]\n    timeout-minutes: 5\n    steps: [{ run: \"echo ok\" }]",
        '  attest:\n    needs: [checks]\n    timeout-minutes: 5\n    permissions: { id-token: write }\n    steps: [{ run: "npx tsx scripts/ci/prove.ts" }]',
      ),
      "id-token or attestations",
    ],
  ])("reports %s", (_label, text, expected) => {
    const problems = lintWorkflows([wf("resurrect.yml", text)]);
    expect(problems.some((p) => p.includes(expected))).toBe(true);
  });

  it("reports differing Node versions across resurrect.yml and nightly.yml", () => {
    const other = goodResurrect.replace(`node-version: ${PINNED_NODE_VERSION}`, "node-version: 26.0.0");
    const problems = lintWorkflows([wf("resurrect.yml", goodResurrect), wf("nightly.yml", other)]);
    expect(problems.some((p) => p.startsWith("nightly.yml") && p.includes("differs"))).toBe(true);
  });

  it("accepts a good nightly.yml and applies the pipeline rules to a bad one", () => {
    const good = `
on: { schedule: [{ cron: "17 3 * * *" }], workflow_dispatch: {} }
permissions: {}
jobs:
  verify:
    timeout-minutes: 60
    permissions: { contents: read, attestations: read }
    steps:
      - uses: actions/checkout@${SHA}
        with: { persist-credentials: false }
      - uses: actions/setup-node@${SHA}
        with: { node-version: ${PINNED_NODE_VERSION} }
      - run: npx tsx scripts/ci/nightly.ts
`;
    expect(lintWorkflows([wf("nightly.yml", good)])).toEqual([]);
    const bad = good
      .replace("{ persist-credentials: false }", "{ fetch-depth: 0 }")
      .replace("    timeout-minutes: 60\n", "")
      .replace("npx tsx scripts/ci/nightly.ts", "echo ${{ github.token }}");
    const problems = lintWorkflows([wf("nightly.yml", bad)]);
    expect(problems.some((p) => p.includes("persist-credentials"))).toBe(true);
    expect(problems.some((p) => p.includes("no timeout-minutes"))).toBe(true);
    expect(problems.some((p) => p.includes("expression inside a run"))).toBe(true);
  });

  it("has nightly.yml with the required triggers, permissions and report upload", () => {
    const nightly = loadWorkflows().find((f) => f.name === "nightly.yml");
    expect(nightly).toBeDefined();
    const doc = nightly?.doc as Workflow & { permissions?: unknown };
    expect(doc.permissions).toEqual({});
    expect(doc.on).toHaveProperty("workflow_dispatch");
    const schedule = (doc.on as { schedule?: { cron?: string }[] }).schedule;
    expect(schedule?.map((s) => s.cron)).toEqual(["17 3 * * *"]);
    expect(Object.keys(doc.jobs ?? {})).toEqual(["verify"]);
    const verify = doc.jobs?.["verify"];
    expect(verify?.permissions).toEqual({ contents: "read", attestations: "read" });
    expect(lintWorkflows(nightly ? [nightly] : [])).toEqual([]);
    const text = nightly?.text ?? "";
    for (const forbidden of ["id-token", "attestations: write", "contents: write", "issues:", "pull-requests"]) {
      expect(text).not.toContain(forbidden);
    }
    const upload = verify?.steps?.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with?.["name"]).toBe("nightly-report");
    expect((upload as { if?: string }).if).toBe("always()");
  });

  it("finds the workflows directory", () => {
    expect(existsSync(workflowDir)).toBe(true);
  });
});
