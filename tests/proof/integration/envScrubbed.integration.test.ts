// Task 18.5: the sandbox child does not inherit the parent's environment (Requirements 5.3, 5.18, 5.19).
//
// The engine passes only `TZ=UTC`. On Windows the process launcher adds standard OS variables
// (11 names observed in the task 1.4 spike), so this test does NOT assert an empty environment.
// It asserts that parent-only variables are absent. Only names are ever compared or printed.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSandboxEnv } from "../../../src/proof/shell/executor/sandboxCommand";
import { readChildEnvKeys, withExecutor } from "./helpers/sandboxHarness";

/** The 11 names the Windows launcher added in the spike (journal, task 1.4). */
const WINDOWS_LAUNCHER_NAMES: ReadonlySet<string> = new Set([
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);

/** Names (not values) of parent variables that look like secrets. */
const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD/i;

const SENTINEL_NAME = "GS_TEST_SECRET";
const SENTINEL_VALUE = `sentinel-${randomBytes(12).toString("hex")}`;
const RANDOM_NAME = `GS_RANDOM_${randomBytes(8).toString("hex").toUpperCase()}`;
const RANDOM_VALUE = `random-${randomBytes(12).toString("hex")}`;

// A tiny inline package: the TZ value and the offset as the child sees them.
const TZ_PACKAGE = {
  "index.js": [
    "'use strict';",
    "exports.tz = () => process.env.TZ;",
    "exports.offset = () => new Date().getTimezoneOffset();",
    "exports.envValues = () => Object.values(process.env);",
  ].join("\n"),
};

const savedSentinel = process.env[SENTINEL_NAME];

beforeEach(() => {
  process.env[SENTINEL_NAME] = SENTINEL_VALUE;
  process.env[RANDOM_NAME] = RANDOM_VALUE;
});

afterEach(() => {
  if (savedSentinel === undefined) delete process.env[SENTINEL_NAME];
  else process.env[SENTINEL_NAME] = savedSentinel;
  delete process.env[RANDOM_NAME];
});

describe("sandbox child environment is scrubbed", () => {
  it("buildSandboxEnv passes only TZ=UTC, never NODE_OPTIONS, whatever the parent has", () => {
    expect(buildSandboxEnv()).toEqual({ TZ: "UTC" });
    expect(buildSandboxEnv("win32", { NODE_OPTIONS: "--require x", [SENTINEL_NAME]: "v" })).toEqual({ TZ: "UTC" });
    expect(buildSandboxEnv("linux", { NODE_OPTIONS: "--require x" })).toEqual({ TZ: "UTC" });
    expect(Object.keys(buildSandboxEnv())).not.toContain("NODE_OPTIONS");
  });

  it("the child has none of the parent's variables and runs in UTC", async () => {
    // Secret-looking names that exist in the parent right now (names only).
    const parentSecretNames = Object.keys(process.env).filter((n) => SECRET_NAME.test(n));
    expect(parentSecretNames).toContain(SENTINEL_NAME);

    await withExecutor("env-probe", async (ctx) => {
      const keys = await readChildEnvKeys(ctx.side);
      const upper = keys.map((k) => k.toUpperCase());

      // Sentinel and random name are absent.
      expect(upper).not.toContain(SENTINEL_NAME);
      expect(upper).not.toContain(RANDOM_NAME);
      expect(await ctx.side.callValue("hasVar", [SENTINEL_NAME])).toBe(false);
      expect(await ctx.side.callValue("hasVar", [RANDOM_NAME])).toBe(false);
      expect(await ctx.side.callValue("secret")).toBeUndefined();

      // No secret-looking parent variable (by name) reaches the child.
      const leakedSecretNames = parentSecretNames.filter((n) => upper.includes(n.toUpperCase()));
      expect(leakedSecretNames, `secret-looking names present in the child: ${leakedSecretNames.join(", ")}`).toEqual(
        [],
      );

      // NODE_OPTIONS is never passed.
      expect(upper).not.toContain("NODE_OPTIONS");

      // TZ is present; every other key is one the platform launcher is documented to add.
      expect(keys).toContain("TZ");
      const extras = keys.filter((k) => k !== "TZ");
      if (process.platform === "win32") {
        const unexpected = extras.filter((k) => !WINDOWS_LAUNCHER_NAMES.has(k.toUpperCase()));
        expect(unexpected, `unexpected child variable names (names only): ${unexpected.join(", ")}`).toEqual([]);
      } else {
        expect(extras, `unexpected child variable names (names only): ${extras.join(", ")}`).toEqual([]);
      }

      // Time zone as the child sees it.
      const tzSide = await ctx.open(TZ_PACKAGE);
      expect(await tzSide.callValue("tz")).toBe("UTC");
      expect(await tzSide.callValue("offset")).toBe(0);

      // The sentinel and random values appear nowhere in the call outcomes.
      const results = [
        await ctx.side.call("envKeys"),
        await ctx.side.call("secret"),
        await ctx.side.call("hasVar", [SENTINEL_NAME]),
        await tzSide.call("tz"),
        await tzSide.call("envValues"),
      ];
      const serialized = JSON.stringify(results);
      expect(serialized.includes(SENTINEL_VALUE)).toBe(false);
      expect(serialized.includes(RANDOM_VALUE)).toBe(false);

      // Names observed in this run, for the record (names only).
      console.info(`child environment names: ${keys.join(", ")}`);
    });
  }, 30000);
});
