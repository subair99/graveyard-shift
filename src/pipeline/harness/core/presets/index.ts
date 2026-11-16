// The reviewed preset menu: lodash-set and ip-address.
import { IP_ADDRESS_PRESET } from "./ipAddress";
import { LODASH_SET_PRESET } from "./lodashSet";
import type { Preset } from "./types";
export type { InputClassPredicate, Preset, PresetOptions } from "./types";
/** A preset menu: preset name to preset. The compiler takes one as an optional input. */
export type PresetMenu = Readonly<Record<string, Preset>>;
export const PRESETS: Readonly<Record<string, Preset>> = {
  [IP_ADDRESS_PRESET.name]: IP_ADDRESS_PRESET,
  [LODASH_SET_PRESET.name]: LODASH_SET_PRESET,
};
/** Names of the presets a Harness_File may select, sorted. */
export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS).sort();

export function findPreset(name: string, menu: PresetMenu = PRESETS): Preset | undefined {
  return Object.hasOwn(menu, name) ? menu[name] : undefined;
}
