// Proof of Life section (crypt-ui Requirements 5.1 to 5.4, 5.9, 6.4, 6.5). Values as written in proof-report.json.
// Divergences, not-demonstrated deltas and harness errors come first for every Verdict.
import type { EntryView } from "../core/viewModel";
import { NONE, NOT_ATTESTED_SENTENCE, STUB_SENTENCE, UI } from "../core/texts";
import { JsonText } from "./JsonText";
import { OutcomeLabel, StubLabel } from "./Labels";

export function ProofSection({ entry }: { entry: EntryView }) {
  const r = entry.report;
  if (r === null) return null;
  const notAttested = entry.verdict !== "alive";
  const notDemonstrated = r.deltas.filter((d) => d.status === "not-demonstrated");
  return (
    <section aria-labelledby="proof">
      <h2 id="proof">{UI.proofHeading}</h2>
      <p>
        {UI.proofVerdict}: <OutcomeLabel outcome={entry.outcome} label={entry.outcomeLabel} />
        {entry.stub ? (
          <>
            {" "}
            <StubLabel />
          </>
        ) : null}
      </p>
      {entry.stub ? <p>{STUB_SENTENCE}</p> : null}
      {notAttested ? <p>{NOT_ATTESTED_SENTENCE}</p> : null}

      <h3>{UI.divergences}</h3>
      {r.divergences.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <ul>
          {r.divergences.map((d, i) => (
            <li key={i}>
              <p>
                <strong>{d.function}</strong> ({UI.kind}: {d.kind})
              </p>
              <JsonText value={d} />
            </li>
          ))}
        </ul>
      )}

      <h3>{UI.notDemonstrated}</h3>
      {notDemonstrated.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <ul>
          {notDemonstrated.map((d, i) => (
            <li key={i}>
              {d.id} ({d.function})
            </li>
          ))}
        </ul>
      )}

      <h3>{UI.harnessErrors}</h3>
      {r.harnessErrors.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <ul>
          {r.harnessErrors.map((h, i) => (
            <li key={i}>
              {h.kind}
              {h.function !== undefined ? ` (${h.function})` : ""}: {h.message}
            </li>
          ))}
        </ul>
      )}

      <h3>{UI.originalPackage}</h3>
      <dl>
        <dt>{UI.originalVersion}</dt>
        <dd>
          {r.package.name} {r.package.version}
        </dd>
        <dt>{UI.integrityString}</dt>
        <dd>{r.original.integrity}</dd>
        <dt>{UI.integrityVerified}</dt>
        <dd>{r.original.verified ? UI.yes : UI.no}</dd>
        <dt>{UI.resurrectionVersion}</dt>
        <dd>{entry.resurrectionVersion ?? NONE}</dd>
        <dt>{UI.treeHash}</dt>
        <dd>{r.resurrection.treeHash ?? NONE}</dd>
        <dt>{UI.seed}</dt>
        <dd>{r.seed}</dd>
        <dt>{UI.toolVersions}</dt>
        <dd>
          node {r.toolVersions.node}, fast-check {r.toolVersions.fastCheck}, report schema{" "}
          {r.toolVersions.reportSchema}
        </dd>
      </dl>

      <h3>{UI.functionsTested}</h3>
      {r.functionsTested.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <ul>
          {r.functionsTested.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {r.casesPerFunction.length === 0 ? null : (
        <table>
          <caption>{UI.casesCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{UI.colFunction}</th>
              <th scope="col">{UI.colCases}</th>
            </tr>
          </thead>
          <tbody>
            {r.casesPerFunction.map((c, i) => (
              <tr key={i}>
                <th scope="row">{c.function}</th>
                <td>{c.cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{UI.excluded}</h3>
      {r.excludedFunctions.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <ul>
          {r.excludedFunctions.map((x, i) => (
            <li key={i}>
              {x.function}: {x.reason}
            </li>
          ))}
        </ul>
      )}

      <h3>{UI.nonDeterministic}</h3>
      {r.nonDeterministicFunctions.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <ul>
          {r.nonDeterministicFunctions.map((x, i) => (
            <li key={i}>
              <p>{x.function}</p>
              <JsonText value={x} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
