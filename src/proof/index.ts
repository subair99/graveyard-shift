// Public API of the Proof of Life Engine. No function here performs a network request
// (Requirement 1.6).

export { defaultProofDeps, runProofOfLife, validateRequest } from "./shell/orchestrator";
export { canonicalReport } from "./serialize/canonicalReport";
export { deserializeReport } from "./serialize/deserialize";
export type { DeserializeError, DeserializeIssue } from "./serialize/deserialize";
export { RequestValidationError } from "./types";
export type {
  DeclaredDelta,
  Divergence,
  ExcludedFunction,
  ExecutorFactory,
  FunctionHarness,
  HarnessConfig,
  HarnessError,
  HarnessErrorKind,
  ProofDeps,
  ProofReport,
  ProofRequest,
  ProofRun,
  Replay,
  Verdict,
} from "./types";
