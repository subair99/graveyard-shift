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
