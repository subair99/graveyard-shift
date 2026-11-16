// The one builder of `gh attestation verify` commands (R17.1, R18.1, R18.6). Used by the pull
// request text, the README text generator and the nightly. Pure string construction.

import { PREDICATE_TYPE, REPO, SIGNER_WORKFLOW } from "../../common/constants";

const SAFE_ARGUMENT = /^[A-Za-z0-9._\-/@+:=]+$/;

/** Single-quotes an argument that holds characters a shell treats specially. */
function shellArgument(value: string): string {
  if (SAFE_ARGUMENT.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The verification command for one file (the subject path as the reader has it). */
export function verifyCommand(file: string): string {
  return [
    "gh attestation verify",
    shellArgument(file),
    `--repo ${REPO}`,
    `--predicate-type ${PREDICATE_TYPE}`,
    `--signer-workflow ${SIGNER_WORKFLOW}`,
    "--format json",
  ].join(" ");
}

/** One command per subject, in the order given; `prefix` (for example `graveyard/ip/`) is put before each name. */
export function verifyCommands(i: {
  subjects: readonly { name: string }[];
  prefix?: string;
}): string[] {
  const prefix = i.prefix ?? "";
  return i.subjects.map((s) => verifyCommand(`${prefix}${s.name}`));
}
