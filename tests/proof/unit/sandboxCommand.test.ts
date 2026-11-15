// Requirements: 5.2, 5.3, 5.16, 5.17, 5.18
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  buildSandboxArgv,
  buildSandboxEnv,
  type SandboxCommand,
  type SandboxCommandInput,
} from "../../../src/proof/shell/executor/sandboxCommand";

const FORBIDDEN = [
  "--allow-net",
  "--allow-child-process",
  "--allow-worker",
  "--allow-addons",
  "--allow-fs-write",
  "--allow-inspector",
  "--allow-wasi",
  "--allow-ffi",
  "--allow-openssl-store",
];

const win: SandboxCommandInput = {
  execPath: "C:\\Program Files\\nodejs\\node.exe",
  runnerDir: "C:\\dev\\graveyard-shift\\src\\proof\\child",
  runnerEntry: "C:\\dev\\graveyard-shift\\src\\proof\\child\\runner.ts",
  packageDir: "C:\\Users\\Some User\\AppData\\Local\\Temp\\gs-abc\\o",
  extraReadPaths: ["C:\\Users\\SOMEUS~1\\AppData\\Local\\Temp\\gs-abc\\o", "C:\\dev\\h,x\\sandbox"],
  maxOldSpaceMb: 256,
};

const posix: SandboxCommandInput = {
  execPath: "/usr/bin/node",
  runnerDir: "/repo/src/proof/child",
  runnerEntry: "/repo/src/proof/child/runner.ts",
  packageDir: "/tmp/gs a,b/o",
  extraReadPaths: ["/repo/src/proof/harnesses/lodash.set/sandbox"],
  maxOldSpaceMb: 128,
};

function ok(input: SandboxCommandInput): SandboxCommand {
  const r = buildSandboxArgv(input);
  if (!r.ok) throw new Error(`unexpected failure: ${r.error.message}`);
  return r.value;
}

describe("buildSandboxArgv", () => {
  it("builds the exact Windows-style command with one element per path", () => {
    expect(ok(win)).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        "--permission",
        "--allow-fs-read=C:\\dev\\graveyard-shift\\src\\proof\\child",
        "--allow-fs-read=C:\\Users\\Some User\\AppData\\Local\\Temp\\gs-abc\\o",
        "--allow-fs-read=C:\\Users\\SOMEUS~1\\AppData\\Local\\Temp\\gs-abc\\o",
        "--allow-fs-read=C:\\dev\\h,x\\sandbox",
        "--max-old-space-size=256",
        "C:\\dev\\graveyard-shift\\src\\proof\\child\\runner.ts",
      ],
      cwd: "C:\\Users\\Some User\\AppData\\Local\\Temp\\gs-abc\\o",
    });
  });

  it("builds the exact POSIX-style command; a comma path stays one flag", () => {
    expect(ok(posix)).toEqual({
      command: "/usr/bin/node",
      args: [
        "--permission",
        "--allow-fs-read=/repo/src/proof/child",
        "--allow-fs-read=/tmp/gs a,b/o",
        "--allow-fs-read=/repo/src/proof/harnesses/lodash.set/sandbox",
        "--max-old-space-size=128",
        "/repo/src/proof/child/runner.ts",
      ],
      cwd: "/tmp/gs a,b/o",
    });
  });

  it("grants a duplicated path once", () => {
    const c = ok({ ...posix, extraReadPaths: [posix.packageDir, posix.runnerDir] });
    expect(c.args.filter((a) => a.startsWith("--allow-fs-read="))).toHaveLength(2);
  });

  it("never emits a forbidden flag or a comma-joined grant", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z0-9 ,._-]{1,12}$/), { maxLength: 4 }),
        fc.integer({ min: 1, max: 4096 }),
        (names, mb) => {
          const c = ok({
            ...posix,
            extraReadPaths: names.map((n) => `/x/${n}`),
            maxOldSpaceMb: mb,
          });
          expect(c.args[0]).toBe("--permission");
          expect(c.args.at(-1)).toBe(posix.runnerEntry);
          for (const a of c.args) {
            expect(FORBIDDEN.some((f) => a.startsWith(f))).toBe(false);
            if (a.startsWith("--allow-fs-read=")) {
              expect(a.split("--allow-fs-read=")).toHaveLength(2);
            }
          }
          const grants = c.args.filter((a) => a.startsWith("--allow-fs-read="));
          expect(grants.length).toBe(new Set(["/repo/src/proof/child", "/tmp/gs a,b/o", ...names.map((n) => `/x/${n}`)]).size);
        },
      ),
      { numRuns: 50 },
    );
  });

  it.each(["*", "?", "[", "]", "{", "}", "\0", "\n", "\x7f"])(
    "rejects a path containing %j without naming the path",
    (ch) => {
      for (const field of ["packageDir", "runnerDir", "extra"] as const) {
        const bad = `/tmp/secret${ch}dir`;
        const input =
          field === "extra"
            ? { ...posix, extraReadPaths: [bad] }
            : { ...posix, [field]: bad };
        const r = buildSandboxArgv(input);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.kind).toBe("sandbox-unavailable");
          expect(r.error.message).not.toContain("secret");
        }
      }
    },
  );

  it("rejects empty and relative paths", () => {
    for (const bad of ["", "rel/dir", "./x", "..\\x", "C:rel"]) {
      const r = buildSandboxArgv({ ...posix, extraReadPaths: [bad] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("sandbox-unavailable");
    }
    expect(buildSandboxArgv({ ...posix, packageDir: "" }).ok).toBe(false);
  });

  it("rejects an invalid heap limit", () => {
    for (const mb of [0, -1, 1.5, Number.NaN]) {
      expect(buildSandboxArgv({ ...posix, maxOldSpaceMb: mb }).ok).toBe(false);
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input: SandboxCommandInput = { ...win, extraReadPaths: [...win.extraReadPaths] };
    const snapshot = structuredClone(input);
    const a = buildSandboxArgv(input);
    const b = buildSandboxArgv(input);
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });
});

describe("buildSandboxEnv", () => {
  it("is exactly { TZ: 'UTC' } whatever the parent environment holds", () => {
    expect(buildSandboxEnv()).toEqual({ TZ: "UTC" });
    expect(
      buildSandboxEnv("win32", { NODE_OPTIONS: "--inspect", GS_TEST_SECRET: "x", PATH: "p" }),
    ).toEqual({ TZ: "UTC" });
    expect(Object.keys(buildSandboxEnv("linux", { A: "1" }))).toEqual(["TZ"]);
  });
});

describe("buildSandboxArgv path resolution (injected realpath)", () => {
  it("emits the resolved strings, not the input ones, and cwd equals the resolved packageDir", () => {
    const map: Record<string, string> = {
      "/short/RUNNER~1": "/long/runner-dir",
      "/short/PKGDIR~1": "/long/package-dir",
      "/short/EXTRA~1": "/long/extra-dir",
    };
    const input: SandboxCommandInput = {
      execPath: "/usr/bin/node",
      runnerDir: "/short/RUNNER~1",
      runnerEntry: "/long/runner-dir/runner.ts",
      packageDir: "/short/PKGDIR~1",
      extraReadPaths: ["/short/EXTRA~1", "/short/PKGDIR~1"],
      maxOldSpaceMb: 64,
      realpath: (p) => map[p] ?? p,
    };
    const built = ok(input);
    expect(built.args.filter((a) => a.startsWith("--allow-fs-read="))).toEqual([
      "--allow-fs-read=/long/runner-dir",
      "--allow-fs-read=/long/package-dir",
      "--allow-fs-read=/long/extra-dir",
    ]);
    expect(built.args.join("\n")).not.toContain("~1");
    expect(built.cwd).toBe("/long/package-dir");
  });

  it("uses the input path unchanged when realpath throws (for example ENOENT)", () => {
    const built = ok({
      ...posix,
      realpath: () => {
        throw new Error("ENOENT");
      },
    });
    expect(built.cwd).toBe(posix.packageDir);
    expect(built.args).toContain(`--allow-fs-read=${posix.packageDir}`);
  });

  it("expands a grant path with an 8.3 short component with fs.realpath.native", (ctx) => {
    if (process.platform !== "win32") return ctx.skip("8.3 short names exist only on Windows");
    const dir = mkdtempSync(join(tmpdir(), "gs-eight-three-long-name-"));
    try {
      const longPath = realpathSync.native(dir);
      // shell: false; verbatim arguments so that the quotes reach cmd.exe unescaped.
      const shortRun = spawnSync("cmd.exe", ["/d", "/c", `"for %I in ("${longPath}") do @echo %~sI"`], {
        encoding: "utf8",
        shell: false,
        windowsVerbatimArguments: true,
      });
      const shortPath = (shortRun.stdout ?? "").trim();
      if (shortPath === "" || !shortPath.includes("~") || shortPath === longPath) {
        return ctx.skip("8.3 short name generation is disabled or the short path could not be obtained");
      }
      expect(realpathSync.native(shortPath)).toBe(longPath);
      const built = ok({
        ...win,
        runnerDir: shortPath,
        packageDir: shortPath,
        extraReadPaths: [shortPath],
        realpath: realpathSync.native,
      });
      const values = built.args.filter((a) => a.startsWith("--allow-fs-read=")).map((a) => a.slice("--allow-fs-read=".length));
      expect(values).toEqual([longPath]);
      expect(built.cwd).toBe(longPath);
      expect(basename(longPath).length).toBeGreaterThan(12);
      expect(built.args.some((a) => a.includes("~1"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
