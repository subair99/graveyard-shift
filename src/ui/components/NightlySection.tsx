// Last nightly re-verification of one entry (crypt-ui Requirements 12.3 to 12.11).
// Each result is shown as its code, the Site's own label and the report's reason, together; the run's
// conclusion is run-wide text and never the outcome of the entry.
import type { EntryView, NightlyRunView } from "../core/viewModel";
import { NIGHTLY_NO_ENTRY_RESULT, UI } from "../core/texts";
import { NightlyLine } from "./NightlyLine";
import { SafeLink } from "./SafeLink";

export function NightlySection({ entry, run }: { entry: EntryView; run: NightlyRunView | null }) {
  const n = entry.nightly;
  return (
    <section aria-labelledby="nightly">
      <h2 id="nightly">{UI.nightlyHeading}</h2>
      {n.kind === "results" && run !== null ? (
        <div>
          <NightlyLine run={run} />
          <h3>{UI.nightlyResults}</h3>
          <ul>
            {n.results.map((r, i) => (
              <li key={i}>
                <code>{r.code}</code>: {r.label}
              </li>
            ))}
          </ul>
          <p>
            {UI.nightlyReason}: {n.reason}
          </p>
          {n.firstDiffPath !== null ? (
            <p>
              {UI.nightlyFirstDiff}: {n.firstDiffPath}
            </p>
          ) : null}
          {n.facts.length > 0 ? (
            <div>
              <h3>{UI.nightlyFacts}</h3>
              <ul>
                {n.facts.map((f, i) => (
                  <li key={i}>
                    {f.text} ({UI.source}: <SafeLink value={f.sourceUrl} />, {UI.fetched} {f.fetchedAt})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : n.kind === "no-line" ? (
        <div>
          <NightlyLine run={run} />
          <p>{NIGHTLY_NO_ENTRY_RESULT}</p>
        </div>
      ) : (
        <NightlyLine run={run} />
      )}
    </section>
  );
}
