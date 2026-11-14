# Requirements Document

## Introduction

The Autopsy Engine is the core analysis module of Graveyard Shift (Next.js + TypeScript). Given an npm package name, a package.json, or a package-lock.json, the Autopsy Engine collects data from the npm registry, OSV, deps.dev and the GitHub REST API, and returns a Death Certificate for each package. The Death Certificate reports a status, a cause of death, a time of death and vital signs. Every fact carries its source URL and fetch date. Responses are cached. The Autopsy Engine is deterministic and makes no LLM calls.

The fixtures are ip@2.0.1, lodash.set@4.3.2 and inflight@1.0.6, as described in docs/demo-packages.md.

## Glossary

- **Autopsy_Engine**: The module that accepts an input, gathers data, and produces Death Certificates.
- **Input_Parser**: The component of the Autopsy_Engine that extracts package names and versions from a package name, a package.json, or a package-lock.json.
- **Death_Certificate**: The structured result of an autopsy for one package.
- **Status**: One of `alive`, `dying`, `dead`, or `retired-with-successor`.
- **Cause_Of_Death**: One of `maintainer-gone`, `repo-archived`, `unpatched-cve`, or `runtime-rot`. A Death_Certificate may list several causes.
- **Time_Of_Death**: The date of the last release of the package, taken from the npm registry.
- **Vital_Signs**: The maintainers, open vulnerabilities, OpenSSF Scorecard, dependents and weekly downloads of a package.
- **Fact**: A single data value in a Death_Certificate, with a source URL and a fetch date.
- **Source_URL**: The URL of the upstream resource from which a Fact was obtained.
- **Fetch_Date**: The ISO 8601 UTC timestamp at which the upstream resource was fetched.
- **Data_Sources**: The npm registry, OSV, deps.dev and the GitHub REST API.
- **Source_Client**: A component of the Autopsy_Engine that fetches data from one Data_Source.
- **Cache**: The store of Data_Source responses keyed by request, used by the Autopsy_Engine.
- **Cache_TTL**: The time-to-live of a Cache entry, 24 hours unless configured otherwise.
- **Risk_Score**: An integer from 0 to 100 computed by the Autopsy_Engine from Vital_Signs and causes of death.
- **Open_Vulnerability**: A vulnerability reported by OSV for the analyzed version that has no fixed version available.
- **Successor**: A valid npm package name that appears in the npm deprecation message, is not in the Successor_Stoplist, and that exists on the npm registry, and that is either (a) enclosed in backticks, (b) the word immediately after one of the phrases "use", "check out", "switch to" or "replaced by", or (c) the word immediately before the word "instead" (phrase matching is case-insensitive).
- **Successor_Stoplist**: The common English words `it`, `this`, `that`, `them`, `these`, `those`, `the`, `a`, `an`, `something`, `another` and `instead`, compared case-insensitively against a candidate.
- **Dormancy_Threshold**: The period without a release after which a package is considered to have runtime rot, 730 days.
- **Analysis_Date**: The reference date used for age calculations, supplied as input to the Autopsy_Engine.
- **GITHUB_TOKEN**: The environment variable holding the GitHub API token.
- **Fixture_Packages**: ip@2.0.1, lodash.set@4.3.2 and inflight@1.0.6.

## Requirements

### Requirement 1: Parse Input

**User Story:** As a developer, I want to submit a package name, a package.json, or a package-lock.json, so that I can get an autopsy for every package I care about.

#### Acceptance Criteria

1. WHEN a package name with a version is provided, THE Input_Parser SHALL produce one package reference containing the name and the version, where the name is 1 to 214 characters and the version is an exact semver version or a semver range.
2. WHEN a valid package.json of at most 5 MB is provided, THE Input_Parser SHALL produce one package reference for each entry in dependencies, devDependencies, and optionalDependencies, using the version specifier declared in that entry.
3. WHEN a valid package-lock.json of at most 50 MB is provided, THE Input_Parser SHALL produce one package reference with the resolved version for each locked package.
4. WHEN a package name is provided without a version, THE Autopsy_Engine SHALL analyze the version that the npm registry marks as the latest version.
5. WHEN a package reference has an exact semver version, THE Autopsy_Engine SHALL analyze that exact version.
6. WHEN a package reference has a semver range, THE Autopsy_Engine SHALL analyze the highest version published on the npm registry that satisfies the range.
7. IF a package reference has a semver range and no version published on the npm registry satisfies the range, THEN THE Autopsy_Engine SHALL return an error that names the package and the range, produce no Death_Certificate for that package reference, and continue to analyze the remaining package references.
8. IF the provided input is not a valid package name, package.json, or package-lock.json, including input of an unsupported lockfile type such as yarn.lock or pnpm-lock.yaml, THEN THE Input_Parser SHALL return an error that names the input type (package name, package.json, package-lock.json, or the unsupported lockfile type) and the reason for rejection, and SHALL produce zero package references.
9. THE Input_Parser SHALL return package references in ascending order of package name, then version, using code-point string comparison for names and semver precedence for versions, with duplicates (identical name and version) removed.
10. IF a package.json or package-lock.json is provided that contains zero package entries, THEN THE Input_Parser SHALL return an empty list of package references and an indication that no packages were found.
11. IF the npm registry does not respond within 10 seconds or reports no published version for a package name provided without a version, THEN THE Autopsy_Engine SHALL return an error that names the package and the reason, and SHALL continue to analyze the remaining package references.

### Requirement 2: Fetch Registry Data

**User Story:** As a developer, I want data pulled from authoritative registries, so that the autopsy reflects the real state of the package.

#### Acceptance Criteria

1. WHEN an autopsy is requested for a package, THE npm Source_Client SHALL fetch the maintainers, release times, deprecation message, and repository URL from the npm registry.
2. WHEN an autopsy is requested for a package version, THE OSV Source_Client SHALL fetch the vulnerabilities that affect that version from OSV.
3. WHEN an autopsy is requested for a package, THE deps.dev Source_Client SHALL fetch the dependent count and the OpenSSF Scorecard from deps.dev.
4. WHEN a repository URL on github.com is known, THE GitHub Source_Client SHALL fetch the archived flag and the date of the last push from the GitHub REST API.
5. WHEN an autopsy is requested for a package, THE npm Source_Client SHALL fetch the download count for the most recent 7 days from the npm downloads API.
6. WHERE GITHUB_TOKEN is set, THE GitHub Source_Client SHALL send the token as a bearer credential with each GitHub REST API request.
7. IF GITHUB_TOKEN is not set, THEN THE GitHub Source_Client SHALL send requests unauthenticated and record in the Death_Certificate that GitHub data was fetched without a token.
8. THE Autopsy_Engine SHALL exclude the value of GITHUB_TOKEN from every Death_Certificate, log entry, and error message.
9. IF a Data_Source returns an error or does not respond within 10 seconds, THEN THE Autopsy_Engine SHALL mark the affected Vital_Signs as unavailable, record the Data_Source name and the failure reason in the Death_Certificate, and continue the autopsy with the remaining Data_Sources.
10. IF the npm registry reports that the package does not exist, THEN THE Autopsy_Engine SHALL stop the autopsy without calling the remaining Data_Sources, produce no Death_Certificate, and return a not-found error that names the package.
11. IF a Data_Source returns a rate-limit response, THEN THE Autopsy_Engine SHALL mark the affected Vital_Signs as unavailable, record the Data_Source name in the Death_Certificate, record the reset time given by the Data_Source when one is provided, and continue the autopsy with the remaining Data_Sources.
12. IF the npm registry returns no repository URL, or the repository URL is not on github.com, THEN THE Autopsy_Engine SHALL skip the GitHub Source_Client, mark the GitHub Vital_Signs as unavailable, and record in the Death_Certificate that no github.com repository URL was available.

### Requirement 3: Trace Every Fact

**User Story:** As a developer, I want every fact to be traceable, so that I can verify the autopsy myself.

#### Acceptance Criteria

1. WHEN THE Autopsy_Engine produces a Death_Certificate, THE Autopsy_Engine SHALL attach to each Fact exactly one Source_URL that is an absolute URL of at most 2,048 characters and exactly one Fetch_Date in UTC ISO 8601 format with a precision of one second.
2. THE Autopsy_Engine SHALL set the Source_URL of each Fact to the URL of the upstream resource whose response contained the value of the Fact, as requested by the Autopsy_Engine and before any redirect is followed.
3. WHEN a Fact is served from the Cache, THE Autopsy_Engine SHALL set the Fetch_Date of the Fact to the UTC time at which the upstream resource was originally fetched and SHALL NOT set it to the time of the Cache read.
4. WHEN a Fact is derived from more than one upstream resource, THE Autopsy_Engine SHALL list the Source_URL and Fetch_Date of every upstream resource that contributed to the Fact, with a maximum of 20 entries per Fact.
5. IF a Vital_Sign is unavailable because its upstream resource could not be retrieved, THEN THE Autopsy_Engine SHALL include in the Death_Certificate the Source_URL that was attempted and the UTC time of the last attempt, in the same format as a Fetch_Date, together with an indication that the Vital_Sign is unavailable.
6. IF the Autopsy_Engine cannot determine a Source_URL or Fetch_Date for a Fact, THEN THE Autopsy_Engine SHALL omit that Fact from the Death_Certificate and SHALL indicate in the Death_Certificate that the Fact was omitted for missing provenance.

### Requirement 4: Assign Status

**User Story:** As a developer, I want a clear status for each package, so that I can decide quickly whether to keep using it.

#### Acceptance Criteria

1. WHEN the Autopsy_Engine identifies a Successor, THE Autopsy_Engine SHALL assign the status `retired-with-successor` and record the Successor name as a Fact, regardless of whether any cause of death applies.
2. THE Autopsy_Engine SHALL record the npm registry lookup used to confirm the Successor, with its Source_URL, Fetch_Date and result, as a Fact.
3. WHEN several candidates in the npm deprecation message qualify as a Successor, THE Autopsy_Engine SHALL take the candidate that appears first by position in the message.
4. IF a candidate in the npm deprecation message is not a valid npm package name or does not exist on the npm registry, THEN THE Autopsy_Engine SHALL skip that candidate and consider the next candidate by position.
5. IF a candidate in the npm deprecation message, compared case-insensitively, is in the Successor_Stoplist, THEN THE Autopsy_Engine SHALL skip that candidate without looking it up on the npm registry and consider the next candidate by position.
6. WHEN the npm deprecation message contains the word "instead", THE Autopsy_Engine SHALL take the word immediately before "instead" as the candidate for that occurrence.
7. WHEN the npm deprecation message contains one of the phrases "use", "check out", "switch to" or "replaced by", THE Autopsy_Engine SHALL take the word immediately after that phrase as the candidate for that occurrence.
8. WHEN the npm deprecation message is "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.", THE Autopsy_Engine SHALL identify `lru-cache` as the Successor and SHALL NOT identify `it` as the Successor.
9. IF the npm registry lookup of a candidate fails by error, timeout or rate limit so that existence cannot be determined, THEN THE Autopsy_Engine SHALL treat that candidate as not a Successor, record the failure, and consider the next candidate by position.
10. WHEN at least one cause of death applies and no Successor exists, THE Autopsy_Engine SHALL assign the status `dead`.
11. WHEN no cause of death applies, no npm deprecation message exists, and the Risk_Score is an integer from 40 to 100 inclusive, THE Autopsy_Engine SHALL assign the status `dying`.
12. WHEN no cause of death applies, no npm deprecation message exists, and the Risk_Score is an integer from 0 to 39 inclusive, THE Autopsy_Engine SHALL assign the status `alive`.
13. THE Autopsy_Engine SHALL assign exactly one Status to each Death_Certificate, chosen from `retired-with-successor`, `dead`, `dying`, and `alive`.
14. IF the npm deprecation message exists and no Successor can be identified, THEN THE Autopsy_Engine SHALL assign the status `dead` and record the full deprecation message text as a Fact.
15. IF the Risk_Score is missing or outside the range 0 to 100 and no cause of death applies, THEN THE Autopsy_Engine SHALL withhold the statuses `dying` and `alive`, and SHALL report an error on the Death_Certificate indicating that the Risk_Score is invalid.

### Requirement 5: Identify Cause of Death

**User Story:** As a developer, I want to know why a package is dead, so that I can judge whether the cause matters to me.

#### Acceptance Criteria

1. WHEN the GitHub archived flag of the repository is true, THE Autopsy_Engine SHALL add the cause `repo-archived` to the Death_Certificate.
2. WHEN the npm registry metadata for the package lists zero maintainers, THE Autopsy_Engine SHALL add the cause `maintainer-gone` to the Death_Certificate.
3. WHEN the package has at least one Open_Vulnerability, THE Autopsy_Engine SHALL add the cause `unpatched-cve` to the Death_Certificate and list the identifier of each Open_Vulnerability, ordered ascending by identifier, with no duplicate identifiers.
4. WHEN the number of days between the Time_Of_Death and the Analysis_Date exceeds the Dormancy_Threshold and the number of days between the last push to the repository and the Analysis_Date exceeds the Dormancy_Threshold, THE Autopsy_Engine SHALL add the cause `runtime-rot` to the Death_Certificate.
5. WHEN the number of days between the Time_Of_Death and the Analysis_Date exceeds the Dormancy_Threshold and no repository push date is available, THE Autopsy_Engine SHALL add the cause `runtime-rot` to the Death_Certificate.
6. THE Autopsy_Engine SHALL list the causes of a Death_Certificate in the fixed order `maintainer-gone`, `repo-archived`, `unpatched-cve`, `runtime-rot`, and SHALL list each cause at most once.
7. IF the vulnerability record from OSV lists a fixed version that is greater than the analyzed version according to semantic version precedence, and that fixed version is published on the npm registry, THEN THE Autopsy_Engine SHALL treat the vulnerability as patched in a later version and exclude it from the Open_Vulnerability list.
8. IF the vulnerability record from OSV lists a fixed version that is greater than the analyzed version and that fixed version is not published on the npm registry, THEN THE Autopsy_Engine SHALL keep the vulnerability in the Open_Vulnerability list.
9. IF none of the conditions in criteria 1 to 5 is met for a dead package, THEN THE Autopsy_Engine SHALL record an empty cause list on the Death_Certificate and SHALL NOT add any cause.

### Requirement 6: Report Time of Death

**User Story:** As a developer, I want a time of death, so that I can see how long a package has been dormant.

#### Acceptance Criteria

1. WHEN the Autopsy_Engine analyzes a package, THE Autopsy_Engine SHALL set the Time_Of_Death to the publish timestamp of the release with the latest publish timestamp in the npm registry time map, excluding the `created` and `modified` entries.
2. WHEN the Time_Of_Death is set, THE Autopsy_Engine SHALL report the number of whole days between the Time_Of_Death and the Analysis_Date, calculated as the elapsed time in 24-hour units rounded down to the nearest integer.
3. IF the Analysis_Date is earlier than the Time_Of_Death, THEN THE Autopsy_Engine SHALL report 0 days since the Time_Of_Death.
4. WHEN the Autopsy_Engine reports a result for a package of any Status, including `alive`, THE Autopsy_Engine SHALL include the Time_Of_Death and the number of days since the Time_Of_Death in that result.
5. IF the npm registry time map contains no entries other than `created` and `modified`, or contains no entry with a parseable timestamp, THEN THE Autopsy_Engine SHALL report the Time_Of_Death as unavailable, SHALL omit the days-since value, and SHALL indicate that no release publish date was found.

### Requirement 7: Report Vital Signs

**User Story:** As a developer, I want vital signs on each package, so that I can weigh its health in detail.

#### Acceptance Criteria

1. WHEN the Autopsy_Engine produces a Death_Certificate, THE Autopsy_Engine SHALL include in it the maintainers, Open_Vulnerabilities, OpenSSF Scorecard score, dependent count, and weekly download count.
2. WHEN the npm registry returns maintainer data for a package, THE Autopsy_Engine SHALL report the maintainers as a list of npm usernames, with one entry per maintainer, in the order the registry returns them.
3. IF the npm registry returns no maintainers for a package, THEN THE Autopsy_Engine SHALL report the maintainers as an empty list.
4. IF the npm registry request for maintainer data fails or times out after 10 seconds, THEN THE Autopsy_Engine SHALL report the maintainers as unavailable and SHALL still produce the Death_Certificate with the remaining vital signs.
5. WHEN OSV returns Open_Vulnerabilities for a package, THE Autopsy_Engine SHALL report for each Open_Vulnerability the identifier, the list of aliases (empty if OSV provides none), the summary, and the severity when OSV provides one.
6. IF OSV returns no Open_Vulnerabilities for a package, THEN THE Autopsy_Engine SHALL report an empty list of Open_Vulnerabilities, distinct from unavailable.
7. IF the OSV request fails or times out after 10 seconds, THEN THE Autopsy_Engine SHALL report the Open_Vulnerabilities as unavailable and SHALL still produce the Death_Certificate with the remaining vital signs.
8. WHEN deps.dev holds a Scorecard for the package's repository, THE Autopsy_Engine SHALL report the OpenSSF Scorecard score as a number from 0 to 10 inclusive.
9. IF deps.dev holds no Scorecard for the repository, or the deps.dev request fails or times out after 10 seconds, THEN THE Autopsy_Engine SHALL report the OpenSSF Scorecard score as unavailable.
10. WHEN the data source returns a value, THE Autopsy_Engine SHALL report the dependent count and the weekly download count each as a non-negative integer. IF a data source returns no value, or its request fails or times out after 10 seconds, THEN THE Autopsy_Engine SHALL report that count as unavailable, and a value of zero SHALL mean the source reported zero.

### Requirement 8: Compute Risk Score

**User Story:** As a developer, I want a risk score, so that I can rank packages by urgency.

#### Acceptance Criteria

1. WHEN an autopsy completes for a package, THE Autopsy_Engine SHALL compute the Risk_Score as a whole number from 0 to 100 inclusive, using one fixed formula over the causes of death and the available Vital_Signs.
2. THE Autopsy_Engine SHALL produce an identical Risk_Score when run twice on identical inputs.
3. WHEN an Open_Vulnerability is added to the inputs of an autopsy and all other inputs are unchanged, THE Autopsy_Engine SHALL compute a Risk_Score that is greater than or equal to the previous Risk_Score.
4. WHEN a cause of death is added to the inputs of an autopsy and all other inputs are unchanged, THE Autopsy_Engine SHALL compute a Risk_Score that is greater than or equal to the previous Risk_Score.
5. IF the sum of the component contributions exceeds 100, THEN THE Autopsy_Engine SHALL set the Risk_Score to 100. IF the sum is below 0, THEN THE Autopsy_Engine SHALL set the Risk_Score to 0.
6. IF one or more Vital_Signs are unavailable, THEN THE Autopsy_Engine SHALL compute the Risk_Score from the available Vital_Signs, treat each unavailable Vital_Sign as contributing 0 points, and list each unavailable Vital_Sign by name in the Death_Certificate.
7. IF no Vital_Signs are available and no causes of death exist, THEN THE Autopsy_Engine SHALL compute a Risk_Score of 0 and state in the Death_Certificate that no inputs were available.
8. THE Autopsy_Engine SHALL include in the Death_Certificate the point contribution of each cause of death and each available Vital_Sign to the Risk_Score, such that the listed contributions sum to the Risk_Score before clamping to the range 0 to 100.
9. THE Autopsy_Engine SHALL include in the Death_Certificate the formula, with its weights and thresholds, used to compute the Risk_Score.

### Requirement 9: Cache Responses

**User Story:** As a developer, I want responses cached, so that repeated autopsies are fast and stay within API rate limits.

#### Acceptance Criteria

1. WHEN a Source_Client request matches a Cache entry whose age is less than or equal to the Cache_TTL, THE Autopsy_Engine SHALL use the Cache entry and send zero upstream requests for that request.
2. WHEN a Source_Client request matches no Cache entry, or the matching Cache entry's age is greater than the Cache_TTL, THE Autopsy_Engine SHALL fetch the upstream resource and store the response in the Cache with its Fetch_Date, replacing any existing entry for the same Cache key.
3. IF a Data_Source request fails (network error, timeout after 10 seconds, or non-success response) and a Cache entry with age greater than the Cache_TTL exists for the same Cache key, THEN THE Autopsy_Engine SHALL use the stale Cache entry, mark every Fact derived from it as stale, and keep the stale entry unchanged in the Cache.
4. IF a Data_Source request fails and no Cache entry exists for the same Cache key, THEN THE Autopsy_Engine SHALL report the failure for that Data_Source, store nothing in the Cache for that key, and continue analyzing the remaining packages.
5. THE Autopsy_Engine SHALL key each Cache entry by the combination of Data_Source, resource URL, and query parameters, so that a change in any one of the three produces a different Cache key.
6. THE Autopsy_Engine SHALL exclude credentials from Cache keys and Cache entries, so that two requests differing only in credentials produce the same Cache key.
7. WHERE a Cache_TTL is configured, THE Autopsy_Engine SHALL use the configured value in place of the default of 24 hours.
8. IF the configured Cache_TTL is not a positive duration, THEN THE Autopsy_Engine SHALL reject the configuration with an error indicating the invalid Cache_TTL and use the default of 24 hours.
9. WHEN a package-lock.json containing up to 1,000 packages is analyzed, THE Autopsy_Engine SHALL send at most one upstream request per unique Cache key.

### Requirement 10: Deterministic Operation

**User Story:** As a maintainer of Graveyard Shift, I want the engine to be deterministic and free of LLM calls, so that results are reproducible and auditable.

#### Acceptance Criteria

1. THE Autopsy_Engine SHALL make zero network requests to any large language model service during an analysis run.
2. THE Autopsy_Engine SHALL derive Status, causes of death, Time_Of_Death, and Risk_Score only from Data_Source responses, the Analysis_Date, and configuration values, and SHALL NOT use the system clock, random values, or any other input.
3. WHEN the Autopsy_Engine analyzes the same package reference twice with identical Data_Source responses, Analysis_Date, configuration values, and Cache contents, THE Autopsy_Engine SHALL produce two Death_Certificates whose serialized JSON is byte-for-byte identical (idempotence property).
4. THE Autopsy_Engine SHALL order every list in a Death_Certificate by a fixed rule that is documented in the project documentation, and that rule SHALL define a tie-breaker so that no two elements have an undefined relative order.
5. WHEN the Autopsy_Engine serializes a Death_Certificate to JSON, THE Autopsy_Engine SHALL emit keys in the same fixed order for every Death_Certificate, regardless of the order in which the values were computed.
6. WHEN a valid Death_Certificate is serialized to JSON and the JSON is deserialized, THE Autopsy_Engine SHALL produce a Death_Certificate equal to the original in every field (round-trip property).
7. IF the JSON supplied for deserialization is malformed or is missing a required Death_Certificate field, THEN THE Autopsy_Engine SHALL reject it with an error that identifies the invalid or missing field, and SHALL NOT return a partial Death_Certificate.

### Requirement 11: Fixture Verdicts

**User Story:** As a maintainer of Graveyard Shift, I want the demo packages to produce known verdicts, so that the engine can be validated and demonstrated.

#### Acceptance Criteria

1. WHEN the Autopsy_Engine analyzes ip@2.0.1 using recorded fixture responses, THE Autopsy_Engine SHALL return exactly one Death_Certificate with the status `dead`, the cause `unpatched-cve`, and a vulnerability whose identifier or alias is CVE-2024-29415.
2. WHEN the Autopsy_Engine analyzes lodash.set@4.3.2 using recorded fixture responses, THE Autopsy_Engine SHALL return exactly one Death_Certificate with the status `dead`, the cause `unpatched-cve`, and a vulnerability whose identifier or alias is CVE-2020-8203.
3. WHEN the Autopsy_Engine analyzes inflight@1.0.6 using recorded fixture responses, THE Autopsy_Engine SHALL return exactly one Death_Certificate with the status `retired-with-successor` and the Successor `lru-cache`.
4. WHILE the Fixture_Packages tests run, THE Autopsy_Engine SHALL complete each analysis using only recorded responses from the Data_Sources and SHALL make zero outbound network requests.
5. WHEN the Autopsy_Engine analyzes a list of the Fixture_Packages, THE Autopsy_Engine SHALL return exactly one Death_Certificate for each package in the list, ordered by ascending package name using a case-sensitive, code-point comparison (`inflight`, `ip`, `lodash.set` for the three demo packages).
6. IF a recorded fixture response required for a Fixture_Package is missing or cannot be parsed, THEN THE Autopsy_Engine SHALL fail that package's analysis with an error identifying the package and the missing or unparseable response, SHALL make zero network requests as a fallback, and SHALL still return Death_Certificates for the remaining Fixture_Packages in the list.
7. WHEN the Autopsy_Engine analyzes the same Fixture_Package with the same recorded responses twice, THE Autopsy_Engine SHALL return Death_Certificates with identical status, cause, Successor, and vulnerability identifier and alias values in both runs.

### Requirement 12: Property-Based Tests

**User Story:** As a maintainer of Graveyard Shift, I want property-based tests on the engine, so that its core guarantees hold across generated inputs.

#### Acceptance Criteria

1. THE test suite SHALL include a property-based test that, for generated package references, generated Data_Source responses, and a generated Analysis_Date, runs two autopsies with identical Cache contents and passes only if the two resulting Death_Certificates are field-for-field equal.
2. THE test suite SHALL include a property-based test that, for generated autopsy inputs and one generated additional vulnerability not already present in those inputs, computes the Risk_Score before and after adding the vulnerability and passes only if the Risk_Score after is greater than or equal to the Risk_Score before.
3. THE test suite SHALL include a property-based test that, for each generated Death_Certificate, passes only if deserializing the serialized Death_Certificate yields a Death_Certificate equal to the original.
4. THE test suite SHALL include a property-based test that, for each generated Death_Certificate, passes only if every Fact in it has a Source_URL of 1 to 2,048 characters that is not whitespace-only and a Fetch_Date that is a valid calendar date and is not later than the Analysis_Date.
5. THE test suite SHALL run each property-based test with at least 100 generated cases and SHALL fail the test run if any single generated case fails.
6. IF a property-based test fails, THEN THE test suite SHALL report the failing generated input in a minimal (shrunk) form and the random seed needed to reproduce the failure.
7. THE test suite SHALL complete all property-based tests within 120 seconds on a standard development machine.
