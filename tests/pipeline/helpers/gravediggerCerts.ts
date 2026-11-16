// Death certificates of the three demo packages for Gravedigger tests.
// ip and inflight are the committed spike certificates; lodash.set is derived from ip.

import { readFileSync } from "node:fs";
import { DeathCertificateSchema } from "../../../src/engine/types";
import type { DeathCertificate } from "../../../src/engine/types";

function load(name: string): DeathCertificate {
  const url = new URL(`../../../spikes/candidates/certificates/${name}.json`, import.meta.url);
  return DeathCertificateSchema.parse(JSON.parse(readFileSync(url, "utf8")));
}

export const IP_CERT: DeathCertificate = load("ip");
export const INFLIGHT_CERT: DeathCertificate = load("inflight");

export const LODASH_SET_CERT: DeathCertificate = {
  ...IP_CERT,
  package: { name: "lodash.set", version: "4.3.2" },
  causes: ["unpatched-cve"],
  openVulnerabilityIds: ["GHSA-p6mc-m468-83gw"],
};

export function withCert(base: DeathCertificate, patch: Partial<DeathCertificate>): DeathCertificate {
  return { ...base, ...patch };
}

/**
 * ip as the engine builds it when the OSV query fails: the vital sign is unavailable, the id list is
 * empty, the `openVulnerabilities` fact is absent and the unpatched-cve cause is not detected
 * (src/engine/core/certificate.ts).
 */
export const OSV_UNAVAILABLE_CERT: DeathCertificate = DeathCertificateSchema.parse({
  ...IP_CERT,
  causes: IP_CERT.causes.filter((c) => c !== "unpatched-cve"),
  openVulnerabilityIds: [],
  vitalSigns: {
    ...IP_CERT.vitalSigns,
    openVulnerabilities: {
      available: false,
      source: "osv",
      attemptedUrl: "https://api.osv.dev/v1/query",
      attemptedAt: "2026-11-15T19:03:19Z",
      reason: "timeout after 10 seconds",
    },
  },
  facts: IP_CERT.facts.filter((f) => f.key !== "openVulnerabilities"),
});
