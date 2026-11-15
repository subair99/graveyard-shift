// The single output path of the Proof_Engine (Requirement 13.28).
//
// Every log line and every error message passes through `emit`: first the Identity_Redactor, then
// the Identity_Scanner as a backstop. A message is never withheld. If the scanner still finds an
// Identity_Value in the redacted text, the match is replaced by `<user>` and the leak is counted,
// so the orchestrator can end the run with the harness error `identity-leak`.
//
// This file is the only file in `src/proof` that may write to the process streams (checked by
// tests/proof/unit/sourceScan.test.ts). The default sink lives here.

import {
  USER_PLACEHOLDER,
  findIdentity,
  redactIdentity,
  type IdentityValues,
  type Platform,
} from "../core/identity";

/** Receives the final text of one message. */
export type Sink = (line: string) => void;

/** `emit(text)` returns the text that was written. `leaks()` counts messages the scanner still hit. */
export interface Emitter {
  (text: string): string;
  /** Number of messages in which the backstop scanner found an Identity_Value after redaction. */
  leaks(): number;
}

/** Default sink: one line on standard error. */
export const stderrSink: Sink = (line) => {
  process.stderr.write(`${line}\n`);
};

/** Replaces every scanner match by `<user>`. */
function scrub(text: string, identity: IdentityValues, platform: Platform): string {
  const finding = findIdentity(text, identity, platform);
  if (!finding.found) return text;
  let out = "";
  let pos = 0;
  for (const m of finding.matches) {
    out += text.slice(pos, m.index) + USER_PLACEHOLDER;
    pos = m.index + m.length;
  }
  return out + text.slice(pos);
}

export function createEmitter(identity: IdentityValues, platform: Platform, sink: Sink): Emitter {
  let leaks = 0;
  const emit = (text: string): string => {
    const redacted = redactIdentity(text, identity, platform);
    let final = redacted;
    if (findIdentity(redacted, identity, platform).found) {
      leaks += 1;
      final = scrub(redacted, identity, platform);
    }
    try {
      sink(final);
    } catch {
      // A failing sink must not change the result or hide the message from the caller.
    }
    return final;
  };
  return Object.assign(emit, { leaks: (): number => leaks });
}
