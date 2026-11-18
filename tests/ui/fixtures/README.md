# Fixture_Graveyard

Every file under `tests/ui/fixtures/` is test data. No entry here is real: the names `alive-fixture`, `restless-fixture`, `inconclusive-fixture`, `retired-fixture`, `stub-fixture` and `hostile-fixture` are invented. The JSON files were derived from the committed shapes (certificate, eligibility record, Proof_Report, deltas, harness) and from the real builders (`buildStubMarker`, `buildNightlyReport`, `renderNightlyReportJson`, `buildLocalEntry`, `buildStubEntry`, `printLedger`). The entry `lodash.set` holds verbatim copies of the five JSON files of the committed `graveyard/lodash.set` entry, so the name with a dot is tested.

- `graveyard/`: one directory per entry, JSON files only. Tarballs and `*.sigstore.json` bundle files are not committed; `tests/ui/helpers/fixtureTree.ts` adds them to a temporary copy at test time.
- `ledger.json`: local and stub rows, including `not provided` readings.
- `nightly/<case>/`: the contents of `.crypt-nightly/` for each Nightly_Input case: `success` (valid report, conclusion `success`), `failure-no-report` (record only), `undocumented-conclusion` (well-formed conclusion not in the documented list, no report), `other-repo` (report with another `repo`), `malformed-report-failure` and `malformed-report-success` (a present report that fails validation, with a valid run record whose conclusion is `failure` and `success`).
