import { isValidPackageName } from "../parse/packageName";
import type { SourceResult } from "../types";

// Pure core: no clock, env or random. The registry lookup is injected.

export type CandidateRule = "backticks" | "after-phrase" | "before-instead";

export interface Candidate {
  name: string;
  /** Start index of the candidate token in the message. */
  position: number;
  rule: CandidateRule;
}

/** Successor_Stoplist (R4.5), lowercase; candidates are compared case-insensitively. */
export const SUCCESSOR_STOPLIST: readonly string[] = [
  "it",
  "this",
  "that",
  "them",
  "these",
  "those",
  "the",
  "a",
  "an",
  "something",
  "another",
  "instead",
];

/** ok = package exists on the registry; not-found / unavailable = cannot be a Successor. */
export type LookupResult = SourceResult<unknown>;

export type LookupRecord =
  | { name: string; outcome: "result"; result: LookupResult }
  | { name: string; outcome: "threw"; error: string };

const RULE_ORDER: Record<CandidateRule, number> = {
  backticks: 0,
  "after-phrase": 1,
  "before-instead": 2,
};

const TRAILING_PUNCTUATION = /[.,;:!?)\]}"'`>]+$/;
const LEADING_WRAPPERS = /^[("'`[{<]+/;

function cleanWord(word: string): string {
  return word.replace(LEADING_WRAPPERS, "").replace(TRAILING_PUNCTUATION, "");
}

export function extractCandidates(message: string): Candidate[] {
  const found: Candidate[] = [];

  for (const m of message.matchAll(/`([^`]+)`/g)) {
    const name = m[1]?.trim() ?? "";
    if (name.length > 0) found.push({ name, position: m.index, rule: "backticks" });
  }

  for (const m of message.matchAll(/\b(?:use|check out|switch to|replaced by)\s+(\S+)/gi)) {
    const raw = m[1] ?? "";
    const name = cleanWord(raw);
    if (name.length === 0) continue;
    found.push({ name, position: m.index + m[0].length - raw.length, rule: "after-phrase" });
  }

  for (const m of message.matchAll(/(\S+)\s+instead\b/gi)) {
    const raw = m[1] ?? "";
    const name = cleanWord(raw);
    if (name.length === 0) continue;
    found.push({ name, position: m.index, rule: "before-instead" });
  }

  found.sort((a, b) => a.position - b.position || RULE_ORDER[a.rule] - RULE_ORDER[b.rule]);

  // The same token may be found by two rules (e.g. "use `foo`"); keep the first.
  const seen = new Set<string>();
  return found.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

export function isStoplisted(name: string): boolean {
  return SUCCESSOR_STOPLIST.includes(name.toLowerCase());
}

export async function findSuccessor(
  candidates: readonly Candidate[],
  lookup: (name: string) => Promise<LookupResult>,
): Promise<{ successor?: string; lookups: LookupRecord[] }> {
  const lookups: LookupRecord[] = [];
  for (const { name } of candidates) {
    if (isStoplisted(name) || !isValidPackageName(name)) continue;
    let result: LookupResult;
    try {
      result = await lookup(name);
    } catch (e) {
      lookups.push({ name, outcome: "threw", error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    lookups.push({ name, outcome: "result", result });
    if (result.status === "ok") return { successor: name, lookups };
  }
  return { lookups };
}
