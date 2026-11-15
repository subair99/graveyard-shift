// Requirements: 2.3, 2.9, 2.11, 7.8, 7.9, 7.10
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import {
  createDepsDevClient,
  dependentsUrl,
  githubProjectId,
  scorecardUrl,
} from "../../../src/engine/sources/depsdev";
import { createHttpClient } from "../../../src/engine/sources/http";
import type { Clock } from "../../../src/engine/types";

const NOW = "2026-02-03T04:05:06Z";
const clock: Clock = { now: () => new Date("2026-02-03T04:05:06.789Z") };

function setup(handler: (url: string) => Response) {
  const urls: string[] = [];
  const fetchFn = (async (input: unknown) => {
    urls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  const http = createHttpClient({
    fetch: fetchFn,
    clock,
    cache: createMemoryCache(),
    ttlMs: 60_000,
  });
  return { client: createDepsDevClient(http, clock), urls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe("deps.dev client endpoints", () => {
  it("percent-encodes the project id as one v3 path segment", () => {
    expect(scorecardUrl("github.com/facebook/react")).toBe(
      "https://api.deps.dev/v3/projects/github.com%2Ffacebook%2Freact",
    );
  });

  it("uses the v3alpha path and percent-encodes scoped names", () => {
    expect(dependentsUrl("@scope/name", "1.2.3")).toBe(
      "https://api.deps.dev/v3alpha/systems/npm/packages/%40scope%2Fname/versions/1.2.3:dependents",
    );
    expect(dependentsUrl("left-pad", "1.3.0")).toBe(
      "https://api.deps.dev/v3alpha/systems/npm/packages/left-pad/versions/1.3.0:dependents",
    );
  });

  it("derives github project ids from npm repository URL forms", () => {
    expect(githubProjectId("git+https://github.com/a/b.git")).toBe("github.com/a/b");
    expect(githubProjectId("git@github.com:a/b.git")).toBe("github.com/a/b");
    expect(githubProjectId("github:a/b")).toBe("github.com/a/b");
    expect(githubProjectId("https://gitlab.com/a/b")).toBeUndefined();
  });
});

describe("deps.dev scorecard", () => {
  it("returns the overall score with provenance and requests the v3 URL", async () => {
    const { client, urls } = setup(() => json({ scorecard: { overallScore: 7.5 } }));
    const r = await client.scorecard("git+https://github.com/facebook/react.git");
    const url = "https://api.deps.dev/v3/projects/github.com%2Ffacebook%2Freact";
    expect(urls).toEqual([url]);
    expect(r).toEqual({
      status: "ok",
      value: 7.5,
      provenance: [{ sourceUrl: url, fetchedAt: NOW }],
    });
  });

  it("accepts the boundary scores 0 and 10", async () => {
    for (const score of [0, 10]) {
      const { client } = setup(() => json({ scorecard: { overallScore: score } }));
      const r = await client.scorecard("https://github.com/a/b");
      expect(r.status === "ok" && r.value).toBe(score);
    }
  });

  it("returns ok null when the project has no scorecard object", async () => {
    const { client } = setup(() => json({ projectKey: { id: "github.com/a/b" } }));
    const r = await client.scorecard("https://github.com/a/b");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value).toBeNull();
      expect(r.provenance).toHaveLength(1);
    }
  });

  it("treats a 404 project as unavailable with reason 'no scorecard'", async () => {
    const { client } = setup(() => new Response("", { status: 404 }));
    expect(await client.scorecard("https://github.com/a/b")).toEqual({
      status: "unavailable",
      source: "deps.dev",
      attemptedUrl: "https://api.deps.dev/v3/projects/github.com%2Fa%2Fb",
      attemptedAt: NOW,
      reason: "no scorecard",
    });
  });

  it("skips non-github repositories without a request", async () => {
    const { client, urls } = setup(() => json({}));
    const r = await client.scorecard("https://gitlab.com/a/b");
    expect(urls).toHaveLength(0);
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") {
      expect(r.attemptedUrl).toBe("https://gitlab.com/a/b");
      expect(r.reason).toContain("not a github.com repository");
    }
  });

  it("reports unparseable and out-of-range bodies as unavailable", async () => {
    for (const body of ["not json", JSON.stringify({ scorecard: { overallScore: 11 } })]) {
      const { client } = setup(() => new Response(body));
      const r = await client.scorecard("https://github.com/a/b");
      expect(r.status).toBe("unavailable");
    }
  });
});

describe("deps.dev dependents", () => {
  const url = "https://api.deps.dev/v3alpha/systems/npm/packages/%40s%2Fp/versions/2.0.0:dependents";

  it("returns dependentCount with the v3alpha URL as provenance", async () => {
    const { client, urls } = setup(() => json({ dependentCount: 42, directDependentCount: 5 }));
    const r = await client.dependents("@s/p", "2.0.0");
    expect(urls).toEqual([url]);
    expect(r).toEqual({
      status: "ok",
      value: 42,
      provenance: [{ sourceUrl: url, fetchedAt: NOW }],
    });
  });

  it("keeps zero as zero", async () => {
    const { client } = setup(() => json({ dependentCount: 0 }));
    const r = await client.dependents("@s/p", "2.0.0");
    expect(r.status === "ok" && r.value).toBe(0);
  });

  it("reports a missing dependentCount as unavailable with the attempted URL", async () => {
    const { client } = setup(() => json({ directDependentCount: 3 }));
    const r = await client.dependents("@s/p", "2.0.0");
    expect(r).toMatchObject({
      status: "unavailable",
      source: "deps.dev",
      attemptedUrl: url,
      attemptedAt: NOW,
    });
  });

  it("reports unparseable bodies as unavailable", async () => {
    const { client } = setup(() => new Response("<html>"));
    expect((await client.dependents("@s/p", "2.0.0")).status).toBe("unavailable");
  });

  it("reports a 404 as unavailable", async () => {
    const { client } = setup(() => new Response("", { status: 404 }));
    expect(await client.dependents("@s/p", "2.0.0")).toMatchObject({
      status: "unavailable",
      attemptedUrl: url,
    });
  });

  it("reports a server failure as unavailable", async () => {
    const { client } = setup(() => new Response("", { status: 500 }));
    expect(await client.dependents("@s/p", "2.0.0")).toMatchObject({
      status: "unavailable",
      attemptedUrl: url,
      reason: "HTTP 500",
    });
  });

  it("passes the rate limit reset time through", async () => {
    const { client } = setup(
      () => new Response("", { status: 429, headers: { "retry-after": "60" } }),
    );
    const r = await client.dependents("@s/p", "2.0.0");
    expect(r).toMatchObject({
      status: "unavailable",
      reason: "rate limited (HTTP 429)",
      rateLimitResetAt: "2026-02-03T04:06:06Z",
    });
  });
});
