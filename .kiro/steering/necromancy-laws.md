# Necromancy laws (apply to all resurrection work)
- Never change a resurrected package's public API (names, signatures, return shapes).
- Preserve the original license and author credits in every resurrected package.
- Honor semver: a resurrection is a patch or minor release, never a silent breaking change.
- Only resurrect MIT, ISC, BSD or Apache-2.0 packages; publish under @graveyard-shift/<name>. This license list applies to the packages Graveyard Shift resurrects and publishes. The project's own dependencies may use any permissive OSI-approved license, including BlueOak-1.0.0, and each one is listed in PREEXISTING.md with its license.
- If the spec is ambiguous or a property cannot be stated, stop and ask the human.