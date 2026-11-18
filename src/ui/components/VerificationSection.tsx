// Verification section (crypt-ui Requirements 5.5 to 5.8). The commands come from the view model only.
import type { EntryView } from "../core/viewModel";
import { GH_MIN_VERSION } from "../../pipeline/common/constants";
import {
  REPLAY_SENTENCE,
  SIGNATURE_MEANING_SENTENCE,
  SITE_NOT_VERIFIED_SENTENCE,
  UI,
  ghVersionSentence,
  missingBundleSentence,
  unexpectedBundlesSentence,
} from "../core/texts";

export function VerificationSection({ entry }: { entry: EntryView }) {
  if (entry.kind !== "resurrection" || entry.verdict === null) return null;
  if (entry.verdict !== "alive") {
    if (entry.unexpectedBundles.length === 0) return null;
    return (
      <section aria-labelledby="verification">
        <h2 id="verification">{UI.verificationHeading}</h2>
        <p>{unexpectedBundlesSentence(entry.verdict, entry.unexpectedBundles)}</p>
      </section>
    );
  }
  const missing = entry.bundles.filter((b) => !b.present);
  return (
    <section aria-labelledby="verification">
      <h2 id="verification">{UI.verificationHeading}</h2>
      <h3>{UI.bundlesHeading}</h3>
      <ul>
        {entry.bundles.map((b, i) => (
          <li key={i}>
            {b.file}: {b.present ? UI.bundlePresent : UI.bundleMissing}
          </li>
        ))}
      </ul>
      {missing.map((b, i) => (
        <p key={i}>{missingBundleSentence(b.file)}</p>
      ))}
      <h3>{UI.commandsHeading}</h3>
      {entry.verifyCommands.map((c, i) => (
        <pre key={i}>
          <code>{c}</code>
        </pre>
      ))}
      <p>{SIGNATURE_MEANING_SENTENCE}</p>
      <p>{ghVersionSentence(GH_MIN_VERSION)}</p>
      <p>{SITE_NOT_VERIFIED_SENTENCE}</p>
      <p>{REPLAY_SENTENCE}</p>
    </section>
  );
}
