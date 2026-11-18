// Text labels of outcome, package status and stub run (crypt-ui Requirements 6.4, 6.5, 8.4).
// The two meanings of "alive" use different class families and different prefixes.
import type { Outcome } from "../core/viewModel";
import { STUB_LABEL, UI } from "../core/texts";

/** The outcome as text (the label comes from the view model); the class only styles it. */
export function OutcomeLabel({ outcome, label }: { outcome: Outcome; label: string }) {
  return <span className={`label outcome outcome-${outcome}`}>{label}</span>;
}

/** Package health from the certificate; never styled like an outcome. */
export function PackageStatusLabel({ status, statusError }: { status?: string; statusError?: string }) {
  return (
    <span className="label package-status">
      {UI.packageStatus}: {status ?? statusError ?? UI.unavailable}
    </span>
  );
}

export function StubLabel() {
  return <span className="label stub-run">{STUB_LABEL}</span>;
}
