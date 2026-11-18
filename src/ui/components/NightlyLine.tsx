// The run-wide nightly line of the Crypt_Index and of every Entry_Page (crypt-ui Requirements 3.10, 12.6, 12.8, 12.10, 12.11).
import type { NightlyRunView } from "../core/viewModel";
import { NIGHTLY_NONE, UI, nightlyCommitMismatch } from "../core/texts";
import { SiteLink } from "./SiteLink";

export function NightlyLine({ run }: { run: NightlyRunView | null }) {
  if (run === null || run.state === "none-in-build") return <p>{NIGHTLY_NONE}</p>;
  const mismatch = run.commitsDiffer ? <p>{nightlyCommitMismatch(run.headSha, run.buildSha)}</p> : null;
  if (run.sentence !== null) {
    return (
      <div>
        <p>{run.sentence}</p>
        {mismatch}
      </div>
    );
  }
  return (
    <div>
      <p>
        {UI.nightlyFrom}: <SiteLink href={run.runUrl} external>{run.runUrl}</SiteLink>; {UI.runStarted}{" "}
        {run.runStartedAt}; {UI.runConclusion} {run.conclusion}.
      </p>
      {mismatch}
    </div>
  );
}
