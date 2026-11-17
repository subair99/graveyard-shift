// Preset `lodash-set` (design "Harness: Deltas_File, Harness_File, presets and compiler").
// Reuses the reviewed generators, explicit cases and pollution property module of the lodash.set
// harness in src/proof/harnesses/lodash.set/config.ts. No option is accepted.

import { z } from "zod";
import {
  deltaExplicitCases,
  dangerousArgs,
  ordinaryArgs,
  ordinaryExplicitCases,
  pathHasDangerousSegment,
  POLLUTION_MODULE_PATH,
} from "../../../../proof/harnesses/lodash.set/config";
import type { DeclaredDelta } from "../../../../proof/types";
import type { Preset } from "./types";

export const LODASH_SET_PRESET: Preset = {
  name: "lodash-set",
  package: "lodash.set",
  // lodash.set's `module.exports` IS the function; the engine lists that export as `default`.
  functions: ["default"],
  deltaFunctions: ["default"],
  inputClasses: {},
  inputClassDocs: {},
  optionsSchema: z.strictObject({}),
  build: (_options, _fn) => ({
    args: ordinaryArgs,
    explicitCases: ordinaryExplicitCases,
    caseCount: 100,
  }),
  prototypeUnchangedDelta: (id: string, fn: string): DeclaredDelta => ({
    id,
    function: fn,
    predicate: pathHasDangerousSegment,
    propertyModule: POLLUTION_MODULE_PATH,
    explicitCases: deltaExplicitCases,
    generator: dangerousArgs,
    caseCount: 100,
  }),
};
