// Preset interface: one reviewed entry of the menu the Harness_File may select from.

import type { z } from "zod";
import type { DeclaredDelta, FunctionHarness } from "../../../../proof/types";

export type PresetOptions = Record<string, string | number | boolean | null>;

export interface Preset {
  /** Name used in the Harness_File (`preset`). */
  readonly name: string;
  /** The package this preset is written for. */
  readonly package: string;
  /** Export names the preset can test. */
  readonly functions: readonly string[];
  /** Strict schema of the options a Harness_File may give. */
  readonly optionsSchema: z.ZodType<PresetOptions>;
  build(options: PresetOptions): FunctionHarness;
  /** Present when the preset can lower a `prototype-unchanged` delta. */
  readonly prototypeUnchangedDelta?: (id: string, fn: string) => DeclaredDelta;
}
