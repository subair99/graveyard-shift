// Attempts table (crypt-ui Requirement 13): Ledger_Entry_Text as typed; no computed figure.
import type { AttemptRow } from "../core/viewModel";
import { ATTEMPTS_CAPTION, ATTEMPTS_NOTE, NO_ATTEMPTS_SENTENCE, UI } from "../core/texts";

export function AttemptsTable({ rows }: { rows: readonly AttemptRow[] }) {
  return (
    <section aria-labelledby="attempts">
      <h2 id="attempts">{UI.attemptsHeading}</h2>
      {rows.length === 0 ? (
        <p>{NO_ATTEMPTS_SENTENCE}</p>
      ) : (
        <div>
          <p>{ATTEMPTS_NOTE}</p>
          <table>
            <caption>{ATTEMPTS_CAPTION}</caption>
            <thead>
              <tr>
                <th scope="col">{UI.colDate}</th>
                <th scope="col">{UI.colMode}</th>
                <th scope="col">{UI.colVersion}</th>
                <th scope="col">{UI.colExit}</th>
                <th scope="col">{UI.colBefore}</th>
                <th scope="col">{UI.colAfter}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td>{r.mode}</td>
                  <td>{r.version}</td>
                  <td>{r.exitCode}</td>
                  <td>{r.creditBefore}</td>
                  <td>{r.creditAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
