---
inclusion: always
---

# Test runs are done by the user

- Do not run `npm test`, `npm run test:*`, or the full vitest suite. The user runs these in their own terminal.
- When a task needs the full suite, stop and write: "Ready for you to run: <exact command>". Then wait for the user to paste the output.
- You may run `npm run typecheck`, `npm run lint`, and one test file at a time (`npx vitest run <path>`) to check your own change, if it takes under about 30 seconds.
- Never run test commands in a loop or "re-run to confirm". One run per change; if it fails, read the output before running again.
- Timings for docs/kiro-journal.md come from the user's pasted runs, not from your own runs.
## Writing files from PowerShell

- Never use Set-Content or Out-File with -Encoding utf8: Windows PowerShell 5.1 adds a BOM. Use your file-editing tools, or [IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false)).
