// Link builders and fixed site names of the Crypt_Site (crypt-ui Requirements 4.10, 7.4, 7.5, 12.4).
// Pure: no I/O, no clock. The builders take names that the reader already accepted; they do not validate.

import { REPO } from "../../pipeline/common/constants";

export const BASE_PATH = "/graveyard-shift";
export const NIGHTLY_INPUT_DIR = ".crypt-nightly";
export const NIGHTLY_REPORT_FILE = "nightly-report.json";
export const NIGHTLY_RUN_FILE = "run.json";
export const LEDGER_PATH = "ledger.json";
export const GRAVEYARD_PATH = "graveyard";

/**
 * Route parameter of the placeholder page that keeps `generateStaticParams` non-empty when the graveyard has no
 * entry (Next.js 16 rejects an empty array under `output: "export"`; crypt-ui open question 5, user-run 2026-11-18).
 * A leading underscore is never a valid npm package name, so no entry can have this name; the reader rejects it
 * through `supportedPackageNameProblem`. No page links to this route.
 */
export const EMPTY_CRYPT_PARAM = "_empty";

/** "/graveyard-shift" + path; path starts with "/" and, for a page, ends with "/". */
export function sitePath(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** /graveyard-shift/crypt/<enc(name)>/ */
export function entryRoute(name: string): string {
  return sitePath(`/crypt/${encodeURIComponent(name)}/`);
}

/** /graveyard-shift/graveyard/<enc(name)>/<enc(file)> */
export function downloadPath(name: string, file: string): string {
  return sitePath(`/${GRAVEYARD_PATH}/${encodeURIComponent(name)}/${encodeURIComponent(file)}`);
}

/** https://github.com/<REPO>/commits/main/graveyard/<enc(name)> */
export function historyUrl(name: string): string {
  return `https://github.com/${REPO}/commits/main/${GRAVEYARD_PATH}/${encodeURIComponent(name)}`;
}

/** https://github.com/<REPO>/actions/runs/<runId> */
export function runUrl(runId: number): string {
  return `https://github.com/${REPO}/actions/runs/${runId}`;
}
