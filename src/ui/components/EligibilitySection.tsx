// Eligibility section (crypt-ui Requirements 4.5 to 4.8). Rules in the order of the file, each with its sources.
import type { EntryView } from "../core/viewModel";
import { NONE, NO_SOURCE_RECORDED, UI } from "../core/texts";
import { FactList } from "./Facts";
import { Sources } from "./Sources";

export function EligibilitySection({ entry }: { entry: EntryView }) {
  const e = entry.eligibility;
  return (
    <section aria-labelledby="eligibility">
      <h2 id="eligibility">{UI.eligibilityHeading}</h2>
      <dl>
        <dt>{UI.eligible}</dt>
        <dd>{e.eligible ? UI.yes : UI.no}</dd>
        {e.successor !== undefined ? (
          <>
            <dt>{UI.successor}</dt>
            <dd>{e.successor}</dd>
          </>
        ) : null}
      </dl>

      <h3>{UI.integrity}</h3>
      <dl>
        <dt>{UI.integrityExpected}</dt>
        <dd>{e.integrity.expected}</dd>
        <dt>{UI.integrityComputed}</dt>
        <dd>{e.integrity.computed ?? NONE}</dd>
        <dt>{UI.integrityMatches}</dt>
        <dd>{e.integrity.matches ? UI.yes : UI.no}</dd>
      </dl>

      <h3>{UI.rules}</h3>
      <ul>
        {e.rules.map((r, i) => {
          const fact = e.facts.find((f) => f.key === `rule.${r.rule}`);
          return (
            <li key={i}>
              <p>
                <strong>{r.rule}</strong>: {UI.ruleHolds} {r.holds ? UI.yes : UI.no}; {UI.ruleObserved}{" "}
                {JSON.stringify(r.observed)}
                {r.reason !== undefined ? `; ${UI.reason} ${r.reason}` : ""}
                {r.missingField !== undefined ? `; ${UI.ruleMissingField} ${r.missingField}` : ""}
              </p>
              {fact !== undefined ? (
                <Sources provenance={fact.provenance} stale={fact.stale} total={fact.provenanceTotal} />
              ) : (
                <p>{NO_SOURCE_RECORDED}</p>
              )}
            </li>
          );
        })}
      </ul>

      <h3>{UI.failedRules}</h3>
      {e.failedRules.length === 0 ? <p>{NONE}</p> : <p>{e.failedRules.join(", ")}</p>}

      <h3>{UI.facts}</h3>
      <FactList facts={e.facts} />
    </section>
  );
}
