// Downloads of the committed files of an entry (crypt-ui Requirement 5.10). Links come from site.ts.
import type { EntryView } from "../core/viewModel";
import { DOWNLOADS_SENTENCE, UI } from "../core/texts";
import { SiteLink } from "./SiteLink";

export function DownloadsSection({ entry }: { entry: EntryView }) {
  return (
    <section aria-labelledby="downloads">
      <h2 id="downloads">{UI.downloadsHeading}</h2>
      <ul>
        {entry.downloads.map((d, i) => (
          <li key={i}>
            <SiteLink href={d.href}>{d.file}</SiteLink>
          </li>
        ))}
      </ul>
      <p>{DOWNLOADS_SENTENCE}</p>
    </section>
  );
}
