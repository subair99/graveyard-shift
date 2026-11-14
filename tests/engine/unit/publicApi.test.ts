import { describe, expect, it } from "vitest";
import * as engine from "../../../src/engine/index";
import * as internal from "../../../src/engine/internal";

describe("public engine API", () => {
  it("exports the documented functions", () => {
    for (const name of [
      "runAutopsy",
      "compareCertificates",
      "canonicalJson",
      "canonicalize",
      "deserialize",
      "parseInput",
      "createMemoryCache",
      "systemClock",
    ]) {
      expect(engine, name).toHaveProperty(name);
    }
    expect(typeof engine.systemClock.now()).toBe("object");
  });

  it("exports source clients only from the internal entry", () => {
    for (const name of [
      "createHttpClient",
      "createNpmClient",
      "createOsvClient",
      "createDepsDevClient",
      "createGitHubClient",
    ]) {
      expect(internal, name).toHaveProperty(name);
      expect(engine).not.toHaveProperty(name);
    }
  });

  it("returns the empty result with a note for a package.json with zero deps", async () => {
    let fetchCalls = 0;
    const fetchFn: typeof fetch = () => {
      fetchCalls++;
      return Promise.reject(new Error("unexpected fetch"));
    };
    const run = await engine.runAutopsy(
      { kind: "package.json", text: JSON.stringify({ name: "app", version: "1.0.0" }) },
      { concurrency: 8, requestTimeoutMs: 10000 },
      { fetch: fetchFn, clock: engine.systemClock, cache: engine.createMemoryCache() },
    );
    expect(run.certificates).toEqual([]);
    expect(run.errors).toEqual([]);
    expect(run.notes).toContain("no packages found");
    expect(fetchCalls).toBe(0);
  });
});
