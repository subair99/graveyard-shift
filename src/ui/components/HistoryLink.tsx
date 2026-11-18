// Link to the GitHub history of the entry's files (crypt-ui Requirement 4.10). No pull request link.
import { UI } from "../core/texts";
import { SiteLink } from "./SiteLink";

export function HistoryLink({ href }: { href: string }) {
  return (
    <p>
      <SiteLink href={href} external>
        {UI.history}
      </SiteLink>
    </p>
  );
}
