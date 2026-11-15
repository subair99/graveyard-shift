// Requirements: 8.2, 10.3, 11.7, 12.1
import { describe, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { runAutopsy } from "../../../src/engine/autopsy";
import { canonicalJson } from "../../../src/engine/serialize/canonicalJson";
import type {
  AutopsyRun,
  Cache,
  CacheEntry,
  Clock,
  EngineConfig,
  EngineInput,
} from "../../../src/engine/types";
import { fc, fcParams } from "../helpers/fc";

/**
 * Feature: autopsy-engine, Property 23: Analysis is idempotent and byte-identical
 *
 * Properties tested (all in memory, no real network, no real clock):
 *  (a) cold + cold: two independent runs from identical empty caches with the same
 *      deterministic clock sequence give equal AutopsyRuns and identical bytes.
 *  (b) warm + warm: two runs from byte-identical copies of the same populated cache,
 *      with the same clock sequence, give equal AutopsyRuns and identical bytes.
 *  (c) latency: with a constant clock, changing fetch latency (and so completion
 *      order) does not change the result.
 *  (d) clock offset: same fetch responses with a supplied Analysis_Date and different
 *      clock offsets give the same packages, order, errors, notes and Analysis_Date.
 *      Bytes may differ only in fetchedAt, which is a clock reading by design.
 *
 * **Validates: Requirements 8.2, 10.3, 11.7, 12.1**
 */

const BASE_MS = Date.parse("2026-03-01T00:00:00Z");
const CONFIG: EngineConfig = { requestTimeoutMs: 10_000, concurrency: 8 };

type Kind = "ok" | "notfound" | "http500" | "throw" | "ratelimit" | "garbage";
const kindArb: fc.Arbitrary<Kind> = fc.constantFrom(
  "ok", "ok", "ok", "notfound", "http500", "throw", "ratelimit", "garbage",
);

const POOL = ["alpha", "beta", "gamma", "delta", "@scope/eps"] as const;
const VERSIONS = ["0.1.0", "1.0.0", "1.2.3", "2.0.0"] as const;
const DEPRECATIONS = [
  "no longer maintained",
  "Use beta instead",
  "This package is not supported. Check out gamma if you want a maintained alternative.",
  "moved to @scope/eps, see https://example.com",
  "deprecated in favour of ghost-package-9",
] as const;

interface PackageSpec {
  name: string;
  versions: string[];
  latest: string;
  deprecated: string | undefined;
  maintainers: string[];
  repository: string | undefined;
  createdSeconds: number;
  npmKind: Kind;
}

interface World {
  packages: PackageSpec[];
  /** One behavior list per source; the entry used is chosen by hashing the request. */
  behaviors: Record<"osv" | "scorecard" | "dependents" | "downloads" | "github", Kind[]>;
  vulns: boolean;
}

const packageSpecArb = (name: string): fc.Arbitrary<PackageSpec> =>
  fc
    .uniqueArray(fc.constantFrom(...VERSIONS), { minLength: 1, maxLength: 4 })
    .chain((versions) =>
      fc.record({
        name: fc.constant(name),
        versions: fc.constant(versions),
        latest: fc.constantFrom(...versions),
        deprecated: fc.option(fc.constantFrom(...DEPRECATIONS), { nil: undefined }),
        maintainers: fc.uniqueArray(fc.constantFrom("bob", "amy", "cy"), { maxLength: 2 }),
        repository: fc.option(
          fc.constantFrom(
            "git+https://github.com/o/r.git",
            "https://github.com/o/other",
            "https://gitlab.com/o/r",
            "not a url",
          ),
          { nil: undefined },
        ),
        createdSeconds: fc.integer({ min: 1_400_000_000, max: 1_770_000_000 }),
        npmKind: kindArb,
      }),
    );

const worldArb: fc.Arbitrary<World> = fc
  .uniqueArray(fc.constantFrom(...POOL), { maxLength: POOL.length })
  .chain((names) =>
    fc.record({
      packages: fc.tuple(...names.map(packageSpecArb)).map((t) => [...t]),
      behaviors: fc.record({
        osv: fc.array(kindArb, { minLength: 1, maxLength: 3 }),
        scorecard: fc.array(kindArb, { minLength: 1, maxLength: 3 }),
        dependents: fc.array(kindArb, { minLength: 1, maxLength: 3 }),
        downloads: fc.array(kindArb, { minLength: 1, maxLength: 3 }),
        github: fc.array(kindArb, { minLength: 1, maxLength: 3 }),
      }),
      vulns: fc.boolean(),
    }),
  );

const specArb = fc.constantFrom("1.0.0", "^1.0.0", "2.0.0", "*", "9.9.9", "~0.1.0", "latest!");
const depNameArb = fc.constantFrom(...POOL, "ghost-package-9");

const inputArb: fc.Arbitrary<EngineInput> = fc.oneof(
  fc.record({
    kind: fc.constant("name" as const),
    name: depNameArb,
    version: fc.option(specArb, { nil: undefined }),
  }).map((r): EngineInput => (r.version === undefined ? { kind: "name", name: r.name } : r)),
  fc
    .uniqueArray(fc.tuple(depNameArb, specArb), { selector: (t) => t[0], maxLength: 5 })
    .map((deps): EngineInput => ({
      kind: "package.json",
      text: JSON.stringify({ dependencies: Object.fromEntries(deps) }),
    })),
  fc
    .uniqueArray(fc.tuple(depNameArb, fc.constantFrom(...VERSIONS, "9.9.9")), {
      selector: (t) => t[0],
      maxLength: 5,
    })
    .map((deps): EngineInput => ({
      kind: "package-lock.json",
      text: JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "root" },
          ...Object.fromEntries(deps.map(([n, v]) => [`node_modules/${n}`, { version: v }])),
        },
      }),
    })),
);

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

function respond(kind: Kind, ok: () => Response): Response {
  switch (kind) {
    case "ok":
      return ok();
    case "notfound":
      return new Response("{}", { status: 404 });
    case "http500":
      return new Response("boom", { status: 500 });
    case "ratelimit":
      return new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
    case "garbage":
      return new Response("<html>{not json", { status: 200 });
    case "throw":
      throw new Error("simulated network timeout");
  }
}

/** A fetch whose answers depend only on the request, and whose latency depends on `salt`. */
function makeFetch(world: World, salt: number): typeof fetch {
  const pick = (kinds: Kind[], key: string): Kind => kinds[hash(key) % kinds.length] ?? "ok";
  return async (input, init) => {
    const url = String(input);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const ticks = hash(`${salt}|${url}|${bodyText}`) % 7;
    for (let i = 0; i < ticks; i++) await Promise.resolve();
    if (ticks % 3 === 0) await new Promise<void>((r) => setTimeout(r, 0));

    const u = new URL(url);
    if (u.host === "registry.npmjs.org") {
      const name = decodeURIComponent(u.pathname.slice(1));
      const p = world.packages.find((x) => x.name === name);
      if (p === undefined) return new Response("{}", { status: 404 });
      return respond(p.npmKind, () => {
        const versions: Record<string, { deprecated?: string }> = {};
        for (const v of p.versions) versions[v] = p.deprecated === undefined ? {} : { deprecated: p.deprecated };
        const time: Record<string, string> = {
          created: new Date(p.createdSeconds * 1000).toISOString(),
        };
        p.versions.forEach((v, i) => {
          time[v] = new Date((p.createdSeconds + (i + 1) * 86_400) * 1000).toISOString();
        });
        return json({
          name,
          maintainers: p.maintainers.map((n) => ({ name: n })),
          time,
          "dist-tags": { latest: p.latest },
          versions,
          ...(p.repository === undefined ? {} : { repository: { url: p.repository } }),
        });
      });
    }
    if (u.host === "api.npmjs.org") {
      return respond(pick(world.behaviors.downloads, url), () => json({ downloads: hash(url) % 5000 }));
    }
    if (u.host === "api.osv.dev") {
      return respond(pick(world.behaviors.osv, `${url}${bodyText}`), () =>
        json({
          vulns: world.vulns
            ? [{ id: "GHSA-aaaa-bbbb-cccc", modified: "2025-01-01T00:00:00Z", severity: [] }]
            : [],
        }),
      );
    }
    if (u.host === "api.deps.dev") {
      if (u.pathname.startsWith("/v3alpha/")) {
        return respond(pick(world.behaviors.dependents, url), () => json({ dependentCount: hash(url) % 99 }));
      }
      return respond(pick(world.behaviors.scorecard, url), () =>
        json({ scorecard: { overallScore: (hash(url) % 100) / 10 } }),
      );
    }
    if (u.host === "api.github.com") {
      return respond(pick(world.behaviors.github, url), () =>
        json({ archived: hash(url) % 2 === 0, pushed_at: "2026-01-02T00:00:00Z" }),
      );
    }
    return new Response("{}", { status: 404 });
  };
}

type ClockMode = { mode: "counter"; startMs: number } | { mode: "constant"; atMs: number };

function makeClock(c: ClockMode): Clock {
  let reads = 0;
  return {
    now: () => (c.mode === "constant" ? new Date(c.atMs) : new Date(c.startMs + 1000 * reads++)),
  };
}

/** In-memory cache that can be copied, so two runs can start from identical contents. */
interface SnapshotCache extends Cache {
  entries: Map<string, CacheEntry>;
}

function snapshotCache(from?: Map<string, CacheEntry>): SnapshotCache {
  const entries = new Map<string, CacheEntry>();
  for (const [k, v] of from ?? []) entries.set(k, { ...v });
  return {
    entries,
    get: (key) => {
      const e = entries.get(key);
      return Promise.resolve(e === undefined ? undefined : { ...e });
    },
    put: (key, entry) => {
      entries.set(key, { ...entry });
      return Promise.resolve();
    },
  };
}

interface RunSetup {
  world: World;
  input: EngineInput;
  salt: number;
  clock: ClockMode;
  cache: Cache;
  analysisDate: Date | undefined;
}

function execute(s: RunSetup): Promise<AutopsyRun> {
  return runAutopsy(
    s.input,
    CONFIG,
    { fetch: makeFetch(s.world, s.salt), clock: makeClock(s.clock), cache: s.cache },
    s.analysisDate,
  );
}

function bytes(run: AutopsyRun): string {
  return run.certificates.map((c) => canonicalJson(c)).join("\n");
}

const analysisDateArb = fc.option(
  fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }).map((ms) => new Date(ms)),
  { nil: undefined },
);

const scenarioArb = fc.record({
  world: worldArb,
  input: inputArb,
  analysisDate: analysisDateArb,
  salt: fc.nat(1000),
  salt2: fc.nat(1000),
  offsetSeconds: fc.integer({ min: 0, max: 5_000_000 }),
});

function expectIdentical(a: AutopsyRun, b: AutopsyRun): void {
  const same =
    JSON.stringify(a.errors) === JSON.stringify(b.errors) &&
    JSON.stringify(a.notes) === JSON.stringify(b.notes) &&
    a.certificates.length === b.certificates.length &&
    bytes(a) === bytes(b) &&
    JSON.stringify(a) === JSON.stringify(b);
  if (!same) {
    throw new Error(
      `runs differ.\nA: ${JSON.stringify(a)}\nB: ${JSON.stringify(b)}`,
    );
  }
}

describe("Feature: autopsy-engine, Property 23: Analysis is idempotent and byte-identical", () => {
  it("cold runs from identical state with the same clock sequence are byte-identical", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const setup = (): RunSetup => ({
          world: s.world,
          input: s.input,
          salt: s.salt,
          clock: { mode: "counter", startMs: BASE_MS },
          cache: createMemoryCache(),
          analysisDate: s.analysisDate,
        });
        expectIdentical(await execute(setup()), await execute(setup()));
      }),
      fcParams(),
    );
  });

  it("two runs from identical warm cache contents are byte-identical", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const seeded = snapshotCache();
        await execute({
          world: s.world,
          input: s.input,
          salt: s.salt,
          clock: { mode: "counter", startMs: BASE_MS },
          cache: seeded,
          analysisDate: s.analysisDate,
        });
        const later: ClockMode = { mode: "counter", startMs: BASE_MS + 3_600_000 };
        const warm = (): RunSetup => ({
          world: s.world,
          input: s.input,
          salt: s.salt,
          clock: later,
          cache: snapshotCache(seeded.entries),
          analysisDate: s.analysisDate,
        });
        expectIdentical(await execute(warm()), await execute(warm()));
      }),
      fcParams(),
    );
  });

  it("changing fetch latency and completion order does not change the result", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const setup = (salt: number): RunSetup => ({
          world: s.world,
          input: s.input,
          salt,
          clock: { mode: "constant", atMs: BASE_MS },
          cache: createMemoryCache(),
          analysisDate: s.analysisDate,
        });
        expectIdentical(await execute(setup(s.salt)), await execute(setup(s.salt2 + 1001)));
      }),
      fcParams(),
    );
  });

  it("with a supplied Analysis_Date, clock offset changes only fetchedAt", async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
        async (s, dateMs) => {
          const date = new Date(dateMs);
          const setup = (atMs: number): RunSetup => ({
            world: s.world,
            input: s.input,
            salt: s.salt,
            clock: { mode: "constant", atMs },
            cache: createMemoryCache(),
            analysisDate: date,
          });
          const a = await execute(setup(BASE_MS));
          const b = await execute(setup(BASE_MS + s.offsetSeconds * 1000));
          const shape = (r: AutopsyRun): string =>
            JSON.stringify({
              packages: r.certificates.map((c) => [c.package, c.analysisDate]),
              errors: r.errors.map((e) => [e.kind, e.package]),
              notes: r.notes,
            });
          if (shape(a) !== shape(b)) throw new Error(`shape differs\n${shape(a)}\n${shape(b)}`);
          // The same clock offset reproduces identical bytes.
          expectIdentical(b, await execute(setup(BASE_MS + s.offsetSeconds * 1000)));
        },
      ),
      fcParams(),
    );
  });
});
