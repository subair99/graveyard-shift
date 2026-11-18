// Declared deltas (crypt-ui Requirement 5.3): the report's status and Demonstration, and deltas.json where present.
import type { EntryView } from "../core/viewModel";
import { NONE, UI } from "../core/texts";
import { JsonText } from "./JsonText";
import { SafeLink } from "./SafeLink";

export function DeltasSection({ entry }: { entry: EntryView }) {
  const r = entry.report;
  const file = entry.deltas;
  if (r === null && file === null) return null;
  return (
    <section aria-labelledby="deltas">
      <h2 id="deltas">{UI.deltasHeading}</h2>
      {r !== null ? (
        <div>
          <h3>{UI.deltaReportHeading}</h3>
          {r.deltas.length === 0 ? (
            <p>{NONE}</p>
          ) : (
            <ul>
              {r.deltas.map((d, i) => (
                <li key={i}>
                  <p>
                    <strong>{d.id}</strong> ({d.function}): {UI.deltaStatus} {d.status};{" "}
                    {d.status === "demonstrated" ? UI.deltaDemonstrated : UI.deltaNotDemonstrated}
                  </p>
                  {d.demonstration !== null ? (
                    <div>
                      <p>{UI.demonstration}</p>
                      <JsonText value={d.demonstration} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {file !== null ? (
        <div>
          <h3>{UI.deltaFileHeading}</h3>
          <ul>
            {file.deltas.map((d, i) => (
              <li key={i}>
                <p>
                  <strong>{d.id}</strong>: {UI.kind} {d.kind}, {d.function}, {UI.advisory} {d.advisory}
                  {"class" in d ? `, ${UI.deltaClass} ${d.class}` : ""}
                </p>
                {"expected" in d ? (
                  <div>
                    <p>{UI.expected}</p>
                    <JsonText value={d.expected} />
                  </div>
                ) : null}
                {"cases" in d ? (
                  <div>
                    <p>{UI.cases}</p>
                    <ul>
                      {d.cases.map((c, j) => (
                        <li key={j}>
                          <p>{UI.input}</p>
                          <JsonText value={c.input} />
                          {"expected" in c ? (
                            <div>
                              <p>{UI.expected}</p>
                              <JsonText value={c.expected} />
                            </div>
                          ) : null}
                          <p>
                            {UI.source}: <SafeLink value={c.source.url} />, {UI.fetched} {c.source.fetchedAt}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
