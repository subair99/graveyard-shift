// The reviewed preset menu. The ip-address preset is added in task group 12.

import { LODASH_SET_PRESET } from "./lodashSet";
import type { Preset } from "./types";

export type { Preset, PresetOptions } from "./types";

export const PRESETS: Readonly<Record<string, Preset>> = {
  [LODASH_SET_PRESET.name]: LODASH_SET_PRESET,
};

/** Names of the presets a Harness_File may select, sorted. */
export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS).sort();

export function findPreset(name: string): Preset | undefined {
  return Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined;
}
