// Preset interface: one reviewed entry of the menu the Harness_File may select from.

import type { z } from "zod";
import type { DeclaredDelta, FunctionHarness } from "../../../../proof/types";

export type PresetOptions = Record<string, string | number | boolean | null>;

/** Pure parent-side predicate over the decoded argument array of one call. */
export type InputClassPredicate = (args: readonly unknown[]) => boolean;

export interface Preset {
  /** Name used in the Harness_File (`preset`). */
  readonly name: string;
  /** The package this preset is written for. */
  readonly package: string;
  /** Export names the preset can test. */
  readonly functions: readonly string[];
  /** Allowlist of the functions that may carry a delta of any kind (R4.13, R4.20). */
  readonly deltaFunctions: readonly string[];
  /**
   * Class menu (R4.16): name to a pure parent-side predicate over the argument array. A
   * `returns-expected-class` delta may name only a class listed here.
   */
  readonly inputClasses: Readonly<Record<string, InputClassPredicate>>;
  /** Strict schema of the options a Harness_File may give. */
  readonly optionsSchema: z.ZodType<PresetOptions>;
  /** Absolute path of a sandbox-side setup module applied to both sides, when the preset needs one. */
  readonly setupModule?: string;
  /** `fn` is the export the entry is for; the compiler always passes it. */
  build(options: PresetOptions, fn: string): FunctionHarness;
  /** Present when the preset can lower a `prototype-unchanged` delta. */
  readonly prototypeUnchangedDelta?: (id: string, fn: string) => DeclaredDelta;
}
