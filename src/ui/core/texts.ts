// Fixed sentences of the Crypt_Site (crypt-ui Requirements 3, 5, 12, 13). Pure.
// Every sentence is written from the specs. No number appears here: a number the page shows comes from an
// input file, and `ghMinVersion` below is passed in by the caller from GH_MIN_VERSION.
// The honesty tests read this one module.

export const SITE_TITLE = "Graveyard Shift";

export const HOME_INTRO =
  "Graveyard Shift finds abandoned npm packages, issues each a cited Death Certificate, and resurrects them on demand with a Proof of Life.";

export const ROLES: readonly { readonly name: string; readonly text: string }[] = [
  { name: "Coroner", text: "deterministic code that makes the Death Certificate." },
  { name: "Gravedigger", text: "deterministic code that fetches and checks the Original and decides eligibility." },
  {
    name: "Medium",
    text: "the only Kiro agent. It runs on demand on the maintainer's machine and makes no CI decision.",
  },
  {
    name: "Undertaker",
    text: "deterministic CI code. It runs the Proof of Life, attests only an alive Verdict, opens the pull request and re-verifies every entry nightly.",
  },
];

export const LLM_SENTENCE = "Only the Medium calls an LLM.";

export const OUTCOME_DEFINITIONS = {
  alive: "alive: zero divergences, every Declared Delta demonstrated and no harness error.",
  restless: "restless: a divergence, or a Declared Delta that was not demonstrated.",
  inconclusive: "inconclusive: the proof could not be completed, for example because of a harness error.",
  "not-resurrected":
    "not resurrected: the package failed an eligibility rule, so nothing was resurrected, proven or attested. This is not a failed run.",
} as const;

export const ATTESTATION_SENTENCE = "Only the Verdict alive is attested.";
export const NEVER_HIDDEN_SENTENCE = "Entries with the Verdict restless or inconclusive are shown and never hidden.";
export const STUB_EXPLANATION = "An entry labelled \"stub run\" is not a Medium-produced resurrection.";

export const STUB_LABEL = "stub run";
export const STUB_SENTENCE = "This entry was produced from a committed fixture and not by the Medium.";

export const NOT_ATTESTED_SENTENCE = "This entry is not attested and is not a successful resurrection.";

export const SIGNATURE_MEANING_SENTENCE =
  "A successful verification proves who signed which digests, not that the content of the predicate is true.";

export function ghVersionSentence(ghMinVersion: string): string {
  return `The gh version ${ghMinVersion} or later is required. Older versions can return exit status 0 when no attestation is present, so inspect the JSON output.`;
}

export const SITE_NOT_VERIFIED_SENTENCE = "This site has not verified the attestations.";

export const REPLAY_SENTENCE =
  "To check the Proof of Life yourself, run npm run proof:run with the committed files of this entry; this site has not replayed it.";

export const DOWNLOADS_SENTENCE =
  "The verification commands expect the files under graveyard/<package>/ relative to the directory where they are run.";

export const EMPTY_CRYPT_SENTENCE = "The graveyard is empty.";

/** Fixed text of the placeholder page at the EMPTY_CRYPT_PARAM route (crypt-ui Requirement 1.6, amended 2026-11-18). */
export const EMPTY_CRYPT_PAGE_SENTENCE = "The crypt is empty. No package has been laid to rest yet.";
export const EMPTY_CRYPT_PAGE_LINK = "Back to the Crypt";
export const NO_SOURCE_RECORDED = "no source was recorded";
export const NOT_RECORDED = "not recorded";
export const NONE = "none";

export const ATTEMPTS_CAPTION = "Attempts recorded in ledger.json";
export const ATTEMPTS_NOTE = "credit meter readings as typed by the user (the meter shows credits used)";
export const NO_ATTEMPTS_SENTENCE = "ledger.json records no attempt for this package.";

export const NIGHTLY_NONE = "No recent nightly result in this build.";
export const NIGHTLY_NO_ENTRY_RESULT = "The nightly run of this build has no result for this package.";

/** The three slots are filled only with `runUrl(runId)` and the strings of the Nightly_Run_Record. */
export function nightlyNoReport(link: string, runStartedAt: string, conclusion: string): string {
  return `The last nightly run (${link}, ${runStartedAt}) ended ${conclusion} without a report.`;
}

export function nightlyReportRejected(link: string, runStartedAt: string, conclusion: string): string {
  return `The last nightly run (${link}, ${runStartedAt}) ended ${conclusion}; its report did not pass validation.`;
}

export function nightlyCommitMismatch(headSha: string, buildSha: string): string {
  return `The nightly run checked commit ${headSha}; this site was built from commit ${buildSha}.`;
}

/** Provenance caption when the file kept only part of the sources; both numbers come from the file or the rendered list. */
export function firstOfSources(shown: number, total: number): string {
  return `first ${shown} of ${total} sources`;
}

export function unexpectedBundlesSentence(verdict: string, files: readonly string[]): string {
  return `This entry has a ${verdict} Verdict and attestation bundle files (${files.join(", ")}) that it should not have. It is not attested.`;
}

export function missingBundleSentence(file: string): string {
  return `The expected attestation bundle ${file} is missing from this entry. It is not attested.`;
}

/** Labels, headings and short phrases of the components. Every one is fixed text. */
export const UI = {
  skipLink: "Skip to main content",
  navLabel: "Main",
  homeNav: "Home",
  cryptNav: "Crypt",
  enterCrypt: "Enter the Crypt",
  homeRoles: "The four roles",
  homeOutcomes: "The four outcomes",
  homeReading: "How to read the Crypt",
  cryptTitle: "The Crypt",
  indexCaption: "Graveyard entries",
  colPackage: "Package",
  colOriginal: "Original version",
  colOutcome: "Outcome",
  colVerdict: "Proof verdict",
  colAnalysed: "analysed",
  colStub: "Stub",
  successor: "Successor",
  packageStatus: "Package status",
  proofVerdict: "Proof verdict",
  outcome: "Outcome",
  unavailable: "unavailable",
  yes: "yes",
  no: "no",
  stale: "stale",
  sources: "Sources",
  source: "Source",
  fetched: "fetched",
  history: "History of this entry's files on GitHub",
  // Certificate
  certificateHeading: "Death Certificate",
  originalVersion: "Original version",
  timeOfDeath: "Time of death",
  daysSinceDeath: "Days since death (at the analysis date)",
  analysed: "analysed",
  riskScore: "Risk score",
  riskContributions: "Risk contributions",
  causes: "Causes of death",
  noCauses: "No cause recorded.",
  openVulnerabilities: "Open vulnerabilities",
  aliases: "Aliases",
  severity: "Severity",
  facts: "Facts",
  omittedFacts: "Omitted facts",
  omittedReason: "reason",
  reason: "reason",
  attemptedUrl: "attempted URL",
  attemptedAt: "attempted at",
  // Eligibility
  eligibilityHeading: "Eligibility",
  eligible: "Eligible",
  integrity: "Integrity",
  integrityExpected: "expected",
  integrityComputed: "computed",
  integrityMatches: "matches",
  rules: "Rules",
  ruleHolds: "holds",
  ruleObserved: "observed",
  ruleMissingField: "missing field",
  failedRules: "Failed rules",
  notResurrectedHeading: "Not resurrected",
  notResurrectedSentence: "Nothing was resurrected, proven or attested for this package.",
  // Proof
  proofHeading: "Proof of Life",
  problemsHeading: "Divergences, undemonstrated deltas and harness errors",
  divergences: "Divergences",
  notDemonstrated: "Declared deltas not demonstrated",
  harnessErrors: "Harness errors",
  excluded: "Excluded functions",
  nonDeterministic: "Non-deterministic functions",
  functionsTested: "Functions tested",
  casesCaption: "Cases per function, as written in proof-report.json",
  colFunction: "Function",
  colCases: "Cases",
  originalPackage: "Original",
  integrityString: "integrity",
  integrityVerified: "verified",
  resurrectionVersion: "Resurrection version (package.json in resurrection.tgz)",
  treeHash: "Tree hash of the resurrection",
  seed: "Seed",
  toolVersions: "Tool versions",
  none: "none",
  kind: "kind",
  details: "details",
  // Deltas
  deltasHeading: "Declared deltas",
  deltaReportHeading: "Declared deltas in the Proof of Life report",
  deltaFileHeading: "Declared deltas in deltas.json",
  deltaStatus: "status",
  deltaDemonstrated: "demonstrated",
  deltaNotDemonstrated: "not demonstrated",
  demonstration: "Demonstration",
  advisory: "Advisory",
  deltaClass: "class",
  expected: "Expected value",
  cases: "Cases",
  input: "input",
  // Verification
  verificationHeading: "Verification",
  bundlesHeading: "Attestation bundles",
  bundlePresent: "present",
  bundleMissing: "missing",
  commandsHeading: "Verification commands",
  // Downloads
  downloadsHeading: "Files of this entry",
  // Nightly
  nightlyHeading: "Last nightly re-verification",
  nightlyFrom: "Nightly results of this build come from this run",
  runStarted: "run started",
  runConclusion: "run conclusion",
  runLink: "run",
  nightlyResults: "Results",
  nightlyReason: "reason",
  nightlyFacts: "Facts",
  nightlyFirstDiff: "first difference at",
  // Attempts
  attemptsHeading: "Attempts",
  colDate: "date",
  colMode: "mode",
  colVersion: "version",
  colExit: "exit code",
  colBefore: "credit before",
  colAfter: "credit after",
} as const;
