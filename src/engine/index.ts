/** Public engine API. Internals (http and source clients) live in ./internal. */
export { runAutopsy, compareCertificates } from "./autopsy";
export { createMemoryCache } from "./cache/cache";
export { systemClock } from "./clock";
export { parseInput } from "./parse/inputParser";
export type { ParseError } from "./parse/inputParser";
export { canonicalJson, canonicalize } from "./serialize/canonicalJson";
export { deserialize } from "./serialize/deserialize";
export type {
  AutopsyError,
  AutopsyRun,
  Cache,
  CacheEntry,
  CauseOfDeath,
  Clock,
  DeathCertificate,
  EngineConfig,
  EngineDeps,
  EngineInput,
  Fact,
  PackageRef,
  Provenance,
  Result,
  Status,
  VitalSigns,
} from "./types";
