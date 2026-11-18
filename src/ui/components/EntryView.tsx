// Entry_Page content (crypt-ui Requirements 4 to 6, 8.4, 8.5, 12, 13). One h1 per page.
import type { EntryView as EntryViewData, NightlyRunView } from "../core/viewModel";
import { UI } from "../core/texts";
import { AttemptsTable } from "./AttemptsTable";
import { CertificateSection } from "./CertificateSection";
import { DeltasSection } from "./DeltasSection";
import { DownloadsSection } from "./DownloadsSection";
import { EligibilitySection } from "./EligibilitySection";
import { HistoryLink } from "./HistoryLink";
import { OutcomeLabel, StubLabel } from "./Labels";
import { NightlySection } from "./NightlySection";
import { ProofSection } from "./ProofSection";
import { VerificationSection } from "./VerificationSection";

export function EntryView({ entry, nightlyRun }: { entry: EntryViewData; nightlyRun: NightlyRunView | null }) {
  const resurrection = entry.kind === "resurrection";
  return (
    <div>
      <h1>
        {entry.name} <OutcomeLabel outcome={entry.outcome} label={entry.outcomeLabel} />
        {entry.stub ? (
          <>
            {" "}
            <StubLabel />
          </>
        ) : null}
      </h1>
      {resurrection ? null : (
        <section aria-labelledby="not-resurrected">
          <h2 id="not-resurrected">{UI.notResurrectedHeading}</h2>
          <p>{UI.notResurrectedSentence}</p>
        </section>
      )}
      <HistoryLink href={entry.historyUrl} />
      {resurrection ? <ProofSection entry={entry} /> : null}
      {resurrection ? <DeltasSection entry={entry} /> : null}
      {resurrection ? <VerificationSection entry={entry} /> : null}
      <CertificateSection entry={entry} />
      <EligibilitySection entry={entry} />
      <DownloadsSection entry={entry} />
      <NightlySection entry={entry} run={nightlyRun} />
      <AttemptsTable rows={entry.attempts} />
    </div>
  );
}
