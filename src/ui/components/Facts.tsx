// Facts with value and provenance, and unavailable values, as written in the files (crypt-ui Requirements 4.3, 4.9).
import type { ReactNode } from "react";
import type { Maybe } from "../../engine/types";
import { UI } from "../core/texts";
import { JsonText } from "./JsonText";
import { SafeLink } from "./SafeLink";
import { Sources, type ProvenanceItem } from "./Sources";

export interface FactItem {
  key: string;
  value: unknown;
  provenance: readonly ProvenanceItem[];
  stale?: boolean | undefined;
  provenanceTotal?: number | undefined;
}

export function FactList({ facts }: { facts: readonly FactItem[] }) {
  if (facts.length === 0) return <p>{UI.none}</p>;
  return (
    <ul>
      {facts.map((f, i) => (
        <li key={i}>
          <p>
            <strong>{f.key}</strong>
          </p>
          <JsonText value={f.value} />
          <Sources provenance={f.provenance} stale={f.stale} total={f.provenanceTotal} />
        </li>
      ))}
    </ul>
  );
}

/** A value that the file marks unavailable is shown as "unavailable" with the file's own reason. */
export function MaybeView<T>({ value, children }: { value: Maybe<T>; children: (v: T) => ReactNode }) {
  if (value.available) return <>{children(value.value)}</>;
  return (
    <span>
      {UI.unavailable} ({UI.reason}: {value.reason}; {UI.attemptedUrl}: <SafeLink value={value.attemptedUrl} />;{" "}
      {UI.attemptedAt}: {value.attemptedAt})
    </span>
  );
}
