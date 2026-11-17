// Requirements: 3.2, 3.3, 3.8
// Feature: medium-agent, Property 1: The Write_Guard allows exactly the paths the Shared_Path_Rules accept
// In-process `decide` on an empty temporary root with the real file system. Both directions are checked against the
// Intake_Validator path checks (badPathReason and isAllowlisted, the single source of the Shared_Path_Rules).

import fc from "fast-check";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide, type GuardFs } from "../../../src/pipeline/medium/agent/writeGuard.mjs";
import { badPathReason, isAllowlisted } from "../../../src/pipeline/medium/agent/pathRules.mjs";
import { badPathArb, goodPathArb, outsidePathArb } from "../../pipeline/helpers/intakePathArbitraries";

const realFs: GuardFs = {
  lstat(p) {
    try {
      return lstatSync(p);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw error;
    }
  },
  realpath: (p) => realpathSync(p),
};

const accepts = (path: string): boolean => badPathReason(path) === null && isAllowlisted(path);

let root = "";
let otherRoot = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "gs-p01-root-")));
  otherRoot = realpathSync(mkdtempSync(join(tmpdir(), "gs-p01-other-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
});

/** Independent model of the Root_Relative_Form on an empty root; null when the path has none. */
function expectedForm(raw: string): string | null {
  const rel = relative(root, resolve(root, raw));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** The conditions of criterion 3 that apply before resolution. */
function rejectedBeforeResolution(raw: string): boolean {
  return (
    /[\u0000-\u001f\u007f]/.test(raw) ||
    raw.includes("\\") ||
    /^[A-Za-z]:/.test(raw) ||
    raw.startsWith("//") ||
    raw.startsWith("~")
  );
}

function run(raw: string) {
  const event = JSON.stringify({ hook_event_name: "preToolUse", cwd: root, tool_name: "fs_write", tool_input: { path: raw } });
  return decide(event, realFs);
}

const pathArb: fc.Arbitrary<string> = fc.oneof(
  goodPathArb,
  badPathArb,
  outsidePathArb,
  goodPathArb.map((p) => `./${p}`),
  goodPathArb.map((p) => join(root, p)),
  goodPathArb.map((p) => join(otherRoot, p)),
  goodPathArb.map((p) => `/${p}`),
  goodPathArb.map((p) => `//${p}`),
  goodPathArb.map((p) => `~/${p}`),
  goodPathArb.map((p) => `.graveyard-work/${p}`),
  fc.constantFrom("~", "//", "./", ".", ".graveyard-work/guard.log"),
);

describe("Property 1: the Write_Guard allows exactly the paths the Shared_Path_Rules accept", () => {
  it("allows a path only when its Root_Relative_Form is accepted, and denies every other path", () => {
    fc.assert(
      fc.property(pathArb, (raw) => {
        const decision = run(raw);
        const form = rejectedBeforeResolution(raw) ? null : expectedForm(raw);
        const expectAllow = form !== null && accepts(form);
        expect(decision.exitCode, `path ${JSON.stringify(raw)} form ${JSON.stringify(form)}`).toBe(expectAllow ? 0 : 2);
        if (decision.exitCode === 0) expect(decision.stderrLine).toBeNull();
        else expect(decision.stderrLine?.startsWith("write-guard: blocked:")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("allows every path the Intake_Validator path checks accept as given", () => {
    fc.assert(
      fc.property(goodPathArb, (raw) => {
        expect(accepts(raw)).toBe(true);
        expect(run(raw).exitCode).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("denies every path the Intake_Validator path checks reject as given and that stays rejected after resolution", () => {
    fc.assert(
      fc.property(fc.oneof(badPathArb, outsidePathArb), (raw) => {
        const form = rejectedBeforeResolution(raw) ? null : expectedForm(raw);
        fc.pre(form === null || !accepts(form));
        expect(run(raw).exitCode).toBe(2);
      }),
      { numRuns: 200 },
    );
  });

  it("judges ./ and (on POSIX) absolute inside paths by their Root_Relative_Form", () => {
    expect(run("./resurrection/a.js").exitCode).toBe(0);
    expect(run(join(otherRoot, "resurrection", "a.js")).exitCode).toBe(2);
    if (process.platform !== "win32") expect(run(join(root, "resurrection", "a.js")).exitCode).toBe(0);
  });
});
