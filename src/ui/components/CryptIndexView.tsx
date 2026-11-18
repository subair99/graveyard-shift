// Crypt_Index content (crypt-ui Requirements 3.5 to 3.10). One row per entry; dates as written.
import type { SiteView } from "../core/viewModel";
import { EMPTY_CRYPT_SENTENCE, NONE, UI } from "../core/texts";
import { OutcomeLabel, StubLabel } from "./Labels";
import { NightlyLine } from "./NightlyLine";
import { SiteLink } from "./SiteLink";

export function CryptIndexView({ view }: { view: SiteView }) {
  return (
    <div>
      <h1>{UI.cryptTitle}</h1>
      <NightlyLine run={view.nightlyRun} />
      {view.entries.length === 0 ? (
        <p>{EMPTY_CRYPT_SENTENCE}</p>
      ) : (
        <table>
          <caption>{UI.indexCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{UI.colPackage}</th>
              <th scope="col">{UI.colOriginal}</th>
              <th scope="col">{UI.colOutcome}</th>
              <th scope="col">{UI.colVerdict}</th>
              <th scope="col">{UI.colAnalysed}</th>
              <th scope="col">{UI.colStub}</th>
            </tr>
          </thead>
          <tbody>
            {view.entries.map((e) => {
              const successor = e.outcome === "not-resurrected" ? (e.eligibility.successor ?? e.certificate.successor) : undefined;
              return (
                <tr key={e.name}>
                  <th scope="row">
                    <SiteLink href={e.route}>{e.name}</SiteLink>
                  </th>
                  <td>{e.originalVersion}</td>
                  <td>
                    <OutcomeLabel outcome={e.outcome} label={e.outcomeLabel} />
                    {successor !== undefined ? (
                      <span>
                        {" "}
                        ({UI.successor}: {successor})
                      </span>
                    ) : null}
                  </td>
                  <td>{e.verdict ?? NONE}</td>
                  <td>{e.analysed}</td>
                  <td>{e.stub ? <StubLabel /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
