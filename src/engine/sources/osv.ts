import { z } from "zod";
import { compareCodePoints } from "../serialize/canonicalJson";
import type { Clock, Provenance, SourceResult, Vulnerability } from "../types";
import { formatTimestamp, type HttpClient } from "./http";

/** OSV query endpoint. Recorded as the Source_URL of every OSV fact. */
export const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

/**
 * Upper bound on pages followed through `next_page_token`. OSV pages hold up
 * to 1,000 results, so 10 pages is far above any npm package seen in practice.
 * If a token is still returned after the last allowed page, the result is
 * `unavailable` (an incomplete list must not be shown as complete).
 */
export const MAX_OSV_PAGES = 10;

/** Normalized OSV record: the cited Vulnerability plus fixed versions for the pure core. */
export interface OsvVulnerability extends Vulnerability {
  /** Unique, sorted (code point) fixed versions listed for the queried npm package. */
  fixedVersions: string[];
}

export interface OsvClient {
  /** Vulnerabilities OSV lists for `name@version`. An empty list is an available result. */
  queryVulnerabilities(name: string, version: string): Promise<SourceResult<OsvVulnerability[]>>;
}

// Local tolerant schema: the shared OsvResponseSchema in types.ts does not cover
// `details`, `database_specific`, `affected[].package` or `next_page_token`.
const OsvPageSchema = z.object({
  vulns: z
    .array(
      z.object({
        id: z.string().min(1),
        aliases: z.array(z.string()).optional(),
        summary: z.string().optional(),
        details: z.string().optional(),
        severity: z.array(z.object({ type: z.string(), score: z.string() })).optional(),
        database_specific: z.object({ severity: z.unknown().optional() }).optional(),
        affected: z
          .array(
            z.object({
              package: z
                .object({ name: z.string().optional(), ecosystem: z.string().optional() })
                .optional(),
              ranges: z
                .array(z.object({ events: z.array(z.object({ fixed: z.string().optional() })) }))
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  next_page_token: z.string().optional(),
});
type OsvPage = z.infer<typeof OsvPageSchema>;
type RawVuln = NonNullable<OsvPage["vulns"]>[number];

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

function summaryOf(v: RawVuln): string {
  if (v.summary !== undefined && v.summary.trim().length > 0) return v.summary.trim();
  if (v.details !== undefined) {
    const first = v.details.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (first !== undefined) return first.trim();
  }
  return "";
}

function severityOf(v: RawVuln): string | undefined {
  const label = v.database_specific?.severity;
  if (typeof label === "string" && label.trim().length > 0) return label.trim();
  const entries = (v.severity ?? [])
    .filter((s) => s.type.length > 0 && s.score.length > 0)
    .map((s) => `${s.type}:${s.score}`);
  if (entries.length === 0) return undefined;
  return sortedUnique(entries).join("; ");
}

function fixedVersionsOf(v: RawVuln, name: string): string[] {
  const fixed: string[] = [];
  for (const affected of v.affected ?? []) {
    const pkg = affected.package;
    // Only entries for the analyzed package in the npm ecosystem count. The name is
    // compared exactly (npm names are case-sensitive); the ecosystem ignores case.
    // Entries without a package, or listing sibling packages, are skipped.
    if (pkg === undefined || pkg.name !== name) continue;
    if (pkg.ecosystem === undefined || pkg.ecosystem.toLowerCase() !== "npm") continue;
    for (const range of affected.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed !== undefined && event.fixed.length > 0) fixed.push(event.fixed);
      }
    }
  }
  return sortedUnique(fixed);
}

function normalize(v: RawVuln, name: string): OsvVulnerability {
  const out: OsvVulnerability = {
    id: v.id,
    aliases: sortedUnique(v.aliases ?? []),
    summary: summaryOf(v),
    fixedVersions: fixedVersionsOf(v, name),
  };
  const severity = severityOf(v);
  if (severity !== undefined) out.severity = severity;
  return out;
}

/**
 * Creates the OSV Source_Client. Provenance `sourceUrl` is the query endpoint
 * (OSV_QUERY_URL). The POST body (package, version, page token) is part of the
 * Cache key through the http client, so each query and page caches separately.
 * Never throws. `clock` is used only to stamp `attemptedAt` when the http
 * client reports a 404 (it supplies no timestamp then).
 */
export function createOsvClient(http: HttpClient, clock: Clock): OsvClient {
  async function queryVulnerabilities(
    name: string,
    version: string,
  ): Promise<SourceResult<OsvVulnerability[]>> {
    const byId = new Map<string, OsvVulnerability>();
    const provenance: Provenance[] = [];
    let stale = false;
    let pageToken: string | undefined;

    for (let page = 1; page <= MAX_OSV_PAGES; page++) {
      const body: Record<string, unknown> = {
        package: { name, ecosystem: "npm" },
        version,
      };
      if (pageToken !== undefined) body["page_token"] = pageToken;

      const res = await http.post("osv", OSV_QUERY_URL, JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
      if (res.status === "unavailable") return res;
      if (res.status === "not-found") {
        return {
          status: "unavailable",
          source: "osv",
          attemptedUrl: OSV_QUERY_URL,
          attemptedAt: formatTimestamp(clock.now()),
          reason: "HTTP 404",
        };
      }

      const fetchedAt = res.provenance[0]?.fetchedAt ?? formatTimestamp(clock.now());
      const unusable = (reason: string): SourceResult<OsvVulnerability[]> => ({
        status: "unavailable",
        source: "osv",
        attemptedUrl: OSV_QUERY_URL,
        attemptedAt: fetchedAt,
        reason,
      });

      let json: unknown;
      try {
        json = JSON.parse(res.value.body);
      } catch {
        return unusable("OSV response is not valid JSON");
      }
      const parsed = OsvPageSchema.safeParse(json);
      if (!parsed.success) return unusable("OSV response does not match the expected shape");

      for (const v of parsed.data.vulns ?? []) {
        if (!byId.has(v.id)) byId.set(v.id, normalize(v, name));
      }
      for (const p of res.provenance) {
        if (!provenance.some((q) => q.sourceUrl === p.sourceUrl && q.fetchedAt === p.fetchedAt)) {
          provenance.push(p);
        }
      }
      if (res.stale === true) stale = true;

      const next = parsed.data.next_page_token;
      if (next === undefined || next.length === 0) {
        const value = [...byId.values()].sort((a, b) => compareCodePoints(a.id, b.id));
        const ok: SourceResult<OsvVulnerability[]> = { status: "ok", value, provenance };
        if (stale) ok.stale = true;
        return ok;
      }
      pageToken = next;
    }

    return {
      status: "unavailable",
      source: "osv",
      attemptedUrl: OSV_QUERY_URL,
      attemptedAt: provenance[provenance.length - 1]?.fetchedAt ?? formatTimestamp(clock.now()),
      reason: `OSV returned more than ${MAX_OSV_PAGES} pages; the list would be incomplete`,
    };
  }

  return { queryVulnerabilities };
}
