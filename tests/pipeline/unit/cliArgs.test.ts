// Requirements: 6.1, 6.2, 23.3, 21.10
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseResurrectArgs, usageExitCode } from "../../../src/pipeline/local/core/cliArgs";
import { formatUsageError, USAGE_EXIT_CODE } from "../../../src/pipeline/local/core/usage";

const FIXTURE = "tests/pipeline/fixtures/stub/lodash.set";

for (const [label, fns] of [["posix", path.posix], ["win32", path.win32]] as const) {
  describe(`parseResurrectArgs (${label} path functions)`, () => {
    const parse = (argv: string[]) => parseResurrectArgs(argv, fns);

    it("accepts one package", () => {
      expect(parse(["lodash.set"])).toEqual({ ok: true, value: { package: "lodash.set" } });
    });

    it("accepts --stub before or after the package", () => {
      const expected = { ok: true, value: { package: "lodash.set", stubDir: FIXTURE } };
      expect(parse(["lodash.set", "--stub", FIXTURE])).toEqual(expected);
      expect(parse(["--stub", FIXTURE, "lodash.set"])).toEqual(expected);
    });

    it("accepts the tests/proof/fixtures root and normalises backslashes", () => {
      const r = parse(["ip", "--stub", "tests\\proof\\fixtures\\x\\"]);
      expect(r).toEqual({ ok: true, value: { package: "ip", stubDir: "tests/proof/fixtures/x" } });
    });

    it("rejects no package, two packages, scoped and invalid names", () => {
      for (const argv of [[], ["a", "b"], ["@graveyard-shift/ip"], ["Bad Name"]]) {
        expect(parse(argv).ok).toBe(false);
      }
    });

    it("rejects a missing, repeated or option-like --stub value and unknown options", () => {
      for (const argv of [
        ["ip", "--stub"],
        ["ip", "--stub", "--x"],
        ["ip", "--stub", FIXTURE, "--stub", FIXTURE],
        ["ip", "--force"],
      ]) {
        expect(parse(argv).ok).toBe(false);
      }
    });

    it("rejects absolute paths, drive prefixes, '..' and other roots", () => {
      for (const dir of [
        "/tests/pipeline/fixtures/x",
        "C:\\dev\\tests\\pipeline\\fixtures\\x",
        "C:tests/pipeline/fixtures/x",
        "\\\\server\\share\\tests\\pipeline\\fixtures\\x",
        "tests/pipeline/fixtures/../../../etc",
        "tests\\proof\\fixtures\\..\\x",
        "tests/pipeline/fixtures",
        "tests/proof/other/x",
        "src/x",
        "",
      ]) {
        expect(parse(["ip", "--stub", dir]).ok, dir).toBe(false);
      }
    });
  });
}

describe("usage", () => {
  it("maps a usage error to exit code 64 and prints the reason and the usage", () => {
    const r = parseResurrectArgs([], path.posix);
    if (r.ok) throw new Error("expected a usage error");
    expect(usageExitCode(r.error)).toBe(64);
    expect(USAGE_EXIT_CODE).toBe(64);
    const text = formatUsageError(r.error.message);
    expect(text).toContain("exactly one package name");
    expect(text).toContain("npm run resurrect -- <package> [--stub <fixture-dir>]");
  });
});
