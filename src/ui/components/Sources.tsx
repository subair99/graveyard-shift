// Provenance list: Source_URL and Fetch_Date as written (crypt-ui Requirements 4.3, 4.6, 6.1).
import { NO_SOURCE_RECORDED, UI, firstOfSources } from "../core/texts";
import { SafeLink } from "./SafeLink";

export interface ProvenanceItem {
  sourceUrl: string;
  fetchedAt: string;
}

export function Sources({
  provenance,
  stale,
  total,
}: {
  provenance: readonly ProvenanceItem[];
  stale?: boolean;
  total?: number;
}) {
  if (provenance.length === 0) return <p>{NO_SOURCE_RECORDED}</p>;
  return (
    <div>
      {stale === true ? <p>{UI.stale}</p> : null}
      {total !== undefined ? <p>{firstOfSources(provenance.length, total)}</p> : null}
      <ul>
        {provenance.map((p, i) => (
          <li key={i}>
            {UI.source}: <SafeLink value={p.sourceUrl} />, {UI.fetched} {p.fetchedAt}
          </li>
        ))}
      </ul>
    </div>
  );
}
