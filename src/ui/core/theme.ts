// Theme data of the Crypt_Site (crypt-ui Requirements 8.1, 8.2). Pure.
// One dark theme. globals.css repeats the PALETTE values as custom properties; a test compares them.

export const PALETTE = {
  background: "#0d0b12",
  surface: "#17131f",
  text: "#e8e4f0",
  muted: "#b4adc4",
  link: "#ff9a3c",
  border: "#8a7fa3",
  focus: "#ffd166",
  alive: "#7bd88f",
  restless: "#ff8a8a",
  inconclusive: "#ffd166",
  notResurrected: "#b4adc4",
  packageStatus: "#8ec5ff",
} as const;

export type PaletteName = keyof typeof PALETTE;
export type PairKind = "normal" | "large" | "component";

export interface ColourPair {
  readonly id: string;
  readonly foreground: PaletteName;
  readonly background: PaletteName;
  readonly kind: PairKind;
}

/** Minimum contrast ratio per kind (WCAG 2.2 success criteria 1.4.3 and 1.4.11). */
export const MIN_RATIO: Readonly<Record<PairKind, number>> = {
  normal: 4.5,
  large: 3,
  component: 3,
};

export const PAIRS: readonly ColourPair[] = [
  { id: "text", foreground: "text", background: "background", kind: "normal" },
  { id: "text-on-surface", foreground: "text", background: "surface", kind: "normal" },
  { id: "muted", foreground: "muted", background: "background", kind: "normal" },
  { id: "muted-on-surface", foreground: "muted", background: "surface", kind: "normal" },
  { id: "link", foreground: "link", background: "background", kind: "normal" },
  { id: "link-on-surface", foreground: "link", background: "surface", kind: "normal" },
  { id: "outcome-alive", foreground: "alive", background: "surface", kind: "normal" },
  { id: "outcome-restless", foreground: "restless", background: "surface", kind: "normal" },
  { id: "outcome-inconclusive", foreground: "inconclusive", background: "surface", kind: "normal" },
  { id: "outcome-not-resurrected", foreground: "notResurrected", background: "surface", kind: "normal" },
  { id: "package-status", foreground: "packageStatus", background: "surface", kind: "normal" },
  { id: "boundary", foreground: "border", background: "background", kind: "component" },
  { id: "boundary-on-surface", foreground: "border", background: "surface", kind: "component" },
  { id: "focus-outline", foreground: "focus", background: "background", kind: "component" },
  { id: "focus-outline-on-surface", foreground: "focus", background: "surface", kind: "component" },
];

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => channel(parseInt(h as string, 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** WCAG 2.2 contrast ratio, from 1 to 21; the order of the arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
