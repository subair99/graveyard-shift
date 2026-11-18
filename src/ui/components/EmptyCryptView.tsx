// Placeholder page of the route crypt/_empty (crypt-ui Requirement 1.6, amended 2026-11-18). Fixed text only.
import { sitePath } from "../core/site";
import { EMPTY_CRYPT_PAGE_LINK, EMPTY_CRYPT_PAGE_SENTENCE, UI } from "../core/texts";
import { SiteLink } from "./SiteLink";

export function EmptyCryptView() {
  return (
    <div>
      <h1>{UI.cryptTitle}</h1>
      <p>{EMPTY_CRYPT_PAGE_SENTENCE}</p>
      <p>
        <SiteLink href={sitePath("/crypt/")}>{EMPTY_CRYPT_PAGE_LINK}</SiteLink>
      </p>
    </div>
  );
}
