// Death Certificate section (crypt-ui Requirements 4.1 to 4.4, 4.9). Every value as written in certificate.json.
import type { EntryView } from "../core/viewModel";
import { NOT_RECORDED, UI } from "../core/texts";
import { FactList, MaybeView } from "./Facts";
import { PackageStatusLabel } from "./Labels";

export function CertificateSection({ entry }: { entry: EntryView }) {
  const c = entry.certificate;
  const vulns = c.vitalSigns.openVulnerabilities;
  return (
    <section aria-labelledby="certificate">
      <h2 id="certificate">{UI.certificateHeading}</h2>
      <dl>
        <dt>{UI.originalVersion}</dt>
        <dd>
          {c.package.name} {c.package.version}
        </dd>
        <dt>{UI.packageStatus}</dt>
        <dd>
          <PackageStatusLabel {...(c.status !== undefined ? { status: c.status } : {})} {...(c.statusError !== undefined ? { statusError: c.statusError } : {})} />
        </dd>
        <dt>{UI.timeOfDeath}</dt>
        <dd>
          <MaybeView value={c.timeOfDeath}>{(v) => v}</MaybeView>
        </dd>
        <dt>{UI.daysSinceDeath}</dt>
        <dd>{c.daysSinceDeath === undefined ? NOT_RECORDED : c.daysSinceDeath}</dd>
        <dt>{UI.analysed}</dt>
        <dd>{c.analysisDate}</dd>
        <dt>{UI.riskScore}</dt>
        <dd>{c.riskScore}</dd>
        {c.successor !== undefined ? (
          <>
            <dt>{UI.successor}</dt>
            <dd>{c.successor}</dd>
          </>
        ) : null}
      </dl>

      <h3>{UI.causes}</h3>
      {entry.causes.length === 0 ? (
        <p>{UI.noCauses}</p>
      ) : (
        <ul>
          {entry.causes.map((cause, i) => (
            <li key={i}>
              {cause.code}
              {cause.label !== null ? `: ${cause.label}` : ""}
            </li>
          ))}
        </ul>
      )}

      <h3>{UI.riskContributions}</h3>
      {c.risk.contributions.length === 0 ? (
        <p>{UI.none}</p>
      ) : (
        <ul>
          {c.risk.contributions.map((r, i) => (
            <li key={i}>
              {r.component}: {r.points}
            </li>
          ))}
        </ul>
      )}

      <h3>{UI.openVulnerabilities}</h3>
      <MaybeView value={vulns}>
        {(list) =>
          list.length === 0 ? (
            <p>{UI.none}</p>
          ) : (
            <ul>
              {list.map((v, i) => (
                <li key={i}>
                  <strong>{v.id}</strong>: {v.summary}
                  <br />
                  {UI.aliases}: {v.aliases.length === 0 ? UI.none : v.aliases.join(", ")}
                  {v.severity !== undefined ? (
                    <>
                      <br />
                      {UI.severity}: {v.severity}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </MaybeView>

      <h3>{UI.facts}</h3>
      <FactList facts={c.facts} />

      <h3>{UI.omittedFacts}</h3>
      {c.notes.omittedFacts.length === 0 ? (
        <p>{UI.none}</p>
      ) : (
        <ul>
          {c.notes.omittedFacts.map((o, i) => (
            <li key={i}>
              {o.key} ({UI.omittedReason}: {o.reason})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
