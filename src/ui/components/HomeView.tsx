// Home page content (crypt-ui Requirements 3.1 to 3.4, 3.9). Server component; no computed figure.
import {
  ATTESTATION_SENTENCE,
  HOME_INTRO,
  LLM_SENTENCE,
  NEVER_HIDDEN_SENTENCE,
  OUTCOME_DEFINITIONS,
  ROLES,
  SITE_TITLE,
  STUB_EXPLANATION,
  UI,
} from "../core/texts";
import { sitePath } from "../core/site";
import { SiteLink } from "./SiteLink";

const OUTCOME_ORDER = ["alive", "restless", "inconclusive", "not-resurrected"] as const;

export function HomeView() {
  return (
    <div>
      <h1>{SITE_TITLE}</h1>
      <p>{HOME_INTRO}</p>
      <p>
        <SiteLink href={sitePath("/crypt/")}>{UI.enterCrypt}</SiteLink>
      </p>
      <section aria-labelledby="home-roles">
        <h2 id="home-roles">{UI.homeRoles}</h2>
        <ul>
          {ROLES.map((r) => (
            <li key={r.name}>
              <strong>{r.name}</strong>: {r.text}
            </li>
          ))}
        </ul>
        <p>{LLM_SENTENCE}</p>
      </section>
      <section aria-labelledby="home-outcomes">
        <h2 id="home-outcomes">{UI.homeOutcomes}</h2>
        <ul>
          {OUTCOME_ORDER.map((o) => (
            <li key={o}>{OUTCOME_DEFINITIONS[o]}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="home-reading">
        <h2 id="home-reading">{UI.homeReading}</h2>
        <ul>
          <li>{ATTESTATION_SENTENCE}</li>
          <li>{NEVER_HIDDEN_SENTENCE}</li>
          <li>{STUB_EXPLANATION}</li>
        </ul>
      </section>
    </div>
  );
}
