// The single entry for the real clock, the secure random seed and the process environment
// (R1.6). Production wiring only: core code takes these as injected values, tests inject fakes.

import { randomInt } from "node:crypto";
import { systemClock } from "../../../engine/clock";
import type { Clock } from "../../../engine/types";

export { systemClock };

export interface SystemDeps {
  readonly clock: Clock;
  /** A fresh seed for fast-check, from a secure random source. */
  readonly randomSeed: () => number;
  /** Snapshot of the environment, taken once per call. */
  readonly env: () => Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
}

export function secureRandomSeed(): number {
  return randomInt(0, 2 ** 31);
}

export function envSnapshot(): Record<string, string | undefined> {
  return { ...process.env };
}

export function systemDeps(): SystemDeps {
  return {
    clock: systemClock,
    randomSeed: secureRandomSeed,
    env: envSnapshot,
    platform: process.platform,
  };
}
