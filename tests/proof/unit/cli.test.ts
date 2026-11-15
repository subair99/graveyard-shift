/**
 * CLI tests (task 17.5, Requirements 1.4, 13.26, 13.28). The engine is replaced by a fake `run`, so
 * no sandbox child starts and nothing touches the network.
 */
// Requirements: 1.4, 13.26, 13.28
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli, type CliDeps } from "../../../src/proof/cli";
import type { ProofReport, ProofRequest, ProofRun, Verdict } from "../../../src/proof/types";

const IDENTITY = "zeldatester";
const proofDeps = {
  platform: "posix" as const,
  env: { USERNAME: IDENTITY, HOME: `/home/${IDENTITY}` },
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "gs-cli-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const metaFile = path.join(tmp, "x.meta.json");
writeFileSync(metaFile, JSON.stringify({ name: "lodash.set", version: "4.3.2", integrity: "sha512-AAAA" }));

function fakeRun(verdict: Verdict, json = '{"verdict":"x"}', harnessErrors: unknown[] = []) {
  const seen: ProofRequest[] = [];
  const run: NonNullable<CliDeps["run"]> = async (request, d) => {
    seen.push(request);
    d.sink?.("engine log line");
    const report = {
      package: { name: "lodash.set", version: "4.3.2" },
      verdict,
      seed: request.harness.seed,
      harnessErrors,
    } as unknown as ProofReport;
    return { report, json } satisfies ProofRun;
  };
  return { run, seen };
}

const baseArgs = [
  "--original",
  "o.tgz",
  "--integrity",
  "sha512-AAAA",
  "--version",
  "4.3.2",
  "--resurrection",
  tmp,
  "--harness",
  "lodash.set",
];

describe("runCli", () => {
  it.each([
    ["alive", 0],
    ["restless", 1],
    ["inconclusive", 2],
  ] as const)("exit code for verdict %s is %i, report on stdout, summary on stderr", async (verdict, code) => {
    const { run } = fakeRun(verdict);
    const r = await runCli(baseArgs, { run, proofDeps });
    expect(r.exitCode).toBe(code);
    expect(r.stdout).toBe('{"verdict":"x"}\n');
    expect(r.stderr).toContain(`verdict ${verdict}: lodash.set@4.3.2`);
    expect(r.stderr).toContain("engine log line");
  });

  it("maps arguments into the request and overrides seed, cases, timeout and radius", async () => {
    const { run, seen } = fakeRun("alive");
    await runCli([...baseArgs, "--seed=-7", "--cases", "5", "--timeout", "250", "--radius", "set, get"], {
      run,
      proofDeps,
    });
    const req = seen[0]!;
    expect(req.original).toEqual({
      name: "lodash.set",
      version: "4.3.2",
      tarballPath: path.resolve("o.tgz"),
      integrity: "sha512-AAAA",
    });
    expect(req.resurrection).toEqual({ kind: "directory", path: path.resolve(tmp) });
    expect(req.haunting).toEqual(["set", "get"]);
    expect(req.harness.seed).toBe(-7);
    expect(req.harness.caseCount).toBe(5);
    expect(req.harness.perCallTimeoutMs).toBe(250);
    expect(req.harness.deltas.every((d) => d.caseCount === undefined || d.caseCount === 5)).toBe(true);
  });

  it("treats a resurrection that is not a directory as a tarball", async () => {
    const { run, seen } = fakeRun("alive");
    const args = baseArgs.map((a) => (a === tmp ? path.join(tmp, "r.tgz") : a));
    await runCli(args, { run, proofDeps });
    expect(seen[0]!.resurrection.kind).toBe("tarball");
  });

  it("reads name, version and integrity from --meta", async () => {
    const { run, seen } = fakeRun("alive");
    const args = ["--original", "o.tgz", "--meta", metaFile, "--resurrection", tmp, "--harness", "lodash.set"];
    const r = await runCli(args, { run, proofDeps });
    expect(r.exitCode).toBe(0);
    expect(seen[0]!.original).toMatchObject({ name: "lodash.set", version: "4.3.2", integrity: "sha512-AAAA" });
  });

  it("writes the report to --out and nothing to stdout", async () => {
    const out = path.join(tmp, "sub", "report.json");
    const { run } = fakeRun("restless", '{"verdict":"restless"}');
    const r = await runCli([...baseArgs, "--out", out], { run, proofDeps });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(readFileSync(out, "utf8")).toBe('{"verdict":"restless"}');
  });

  it("loads a harness that is not built in through loadHarness", async () => {
    const { run, seen } = fakeRun("alive");
    const args = baseArgs.map((a) => (a === "lodash.set" ? "./my-harness.ts" : a));
    const loadHarness: NonNullable<CliDeps["loadHarness"]> = async () => ({
      package: "mine",
      seed: 1,
      caseCount: 1,
      perCallTimeoutMs: 1,
      heapLimitMb: 1,
      outputLimitBytes: 1,
      maxRestarts: 0,
      shrinkBudget: 0,
      functions: {},
      deltas: [],
    });
    await runCli(args, { run, proofDeps, loadHarness });
    expect(seen[0]!.harness.package).toBe("mine");
    expect(seen[0]!.original.name).toBe("mine");
  });

  it("passes an injected executor factory into the request", async () => {
    const { run, seen } = fakeRun("alive");
    const executorFactory = { create: () => { throw new Error("not used"); } } as unknown as NonNullable<CliDeps["executorFactory"]>;
    await runCli(baseArgs, { run, proofDeps, executorFactory });
    expect(seen[0]!.executorFactory).toBe(executorFactory);
  });
});

describe("runCli usage errors (exit 64)", () => {
  const cases: [string, string[]][] = [
    ["no arguments", []],
    ["unknown option", [...baseArgs, "--bogus"]],
    ["positional argument", [...baseArgs, "extra"]],
    ["missing --original", baseArgs.slice(2)],
    ["missing integrity and meta", ["--original", "o", "--resurrection", tmp, "--harness", "lodash.set"]],
    ["both --meta and --integrity", [...baseArgs, "--meta", metaFile]],
    ["missing --version without meta", baseArgs.filter((a, i) => a !== "--version" && baseArgs[i - 1] !== "--version")],
    ["non-integer seed", [...baseArgs, "--seed", "1.5"]],
    ["seed above int32", [...baseArgs, "--seed", "2147483648"]],
    ["cases below 1", [...baseArgs, "--cases", "0"]],
    ["timeout below 1", [...baseArgs, "--timeout", "0"]],
    ["empty radius", [...baseArgs, "--radius", " , "]],
    ["unreadable meta", ["--original", "o", "--meta", path.join(tmp, "nope.json"), "--resurrection", tmp, "--harness", "lodash.set"]],
  ];
  it.each(cases)("%s", async (_name, args) => {
    const { run, seen } = fakeRun("alive");
    const r = await runCli(args, { run, proofDeps });
    expect(r.exitCode).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("usage:");
    expect(seen).toHaveLength(0);
  });

  it("--help exits 0 with the usage on stderr", async () => {
    const r = await runCli(["--help"], { proofDeps });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("usage:");
  });

  it("a request validation error from the engine is exit 64", async () => {
    const { RequestValidationError } = await import("../../../src/proof/types");
    const run: NonNullable<CliDeps["run"]> = async () => {
      throw new RequestValidationError("original.integrity", "invalid request, field original.integrity");
    };
    const r = await runCli(baseArgs, { run, proofDeps });
    expect(r.exitCode).toBe(64);
    expect(r.stderr).toContain("original.integrity");
  });

  it("an unexpected failure is exit 2", async () => {
    const run: NonNullable<CliDeps["run"]> = async () => {
      throw new Error("boom");
    };
    const r = await runCli(baseArgs, { run, proofDeps });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("boom");
  });
});

describe("runCli identity handling", () => {
  it("redacts an identity value in its own messages", async () => {
    const r = await runCli([IDENTITY], { proofDeps });
    expect(r.exitCode).toBe(64);
    expect(r.stderr).not.toContain(IDENTITY);
    expect(r.stderr).toContain("<user>");
  });

  it("never writes a report that contains an identity value", async () => {
    const out = path.join(tmp, "leaky.json");
    const { run } = fakeRun("alive", `{"home":"/home/${IDENTITY}/x"}`);
    const r = await runCli([...baseArgs, "--out", out], { run, proofDeps });
    expect(r.exitCode).toBe(2);
    expect(existsSync(out)).toBe(false);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toContain(IDENTITY);
    expect(r.stderr).toContain("identity leak check");
  });

  it("never prints a report that holds an identity-leak harness error", async () => {
    const { run } = fakeRun("inconclusive", '{"v":1}', [{ kind: "identity-leak", message: "m" }]);
    const r = await runCli(baseArgs, { run, proofDeps });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("");
  });
});
