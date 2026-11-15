<#
Secret / identity scan of the whole git history. Read-only: runs only read-only git commands
and writes only spikes/secret-scan/REPORT.md. Prints and writes locations and counts only:
never a matched value, never the user name, e-mail, computer name or home path.

Usage (from the repository root):
  powershell -NoProfile -File spikes/secret-scan/scan.ps1      (Windows PowerShell 5.1)
  pwsh spikes/secret-scan/scan.ps1                              (PowerShell 7, if installed)
Options: -ReportPath <file>, -MaxBlobBytes <int> (default 5242880; larger blobs are listed as skipped)
#>
param(
  [string]$ReportPath = (Join-Path $PSScriptRoot 'REPORT.md'),
  [int]$MaxBlobBytes = 5242880
)
$ErrorActionPreference = 'Stop'
$started = Get-Date
$repoRoot = (& git rev-parse --show-toplevel).Trim()
Set-Location $repoRoot
$latin1 = [Text.Encoding]::GetEncoding(28591)

function G { $ErrorActionPreference = 'Continue'; & git -c core.quotepath=off @args 2>$null }

# ---------- external scanners (use only if present) ----------
$external = @()
foreach ($t in 'gitleaks', 'trufflehog') { if (Get-Command $t -ErrorAction SilentlyContinue) { $external += $t } }

# ---------- collect history: (commit, path, blob) ----------
$headShort = (G rev-parse --short HEAD).Trim()
$unreachable = @(G fsck --unreachable --no-reflogs --no-progress | Where-Object { $_ -match '^unreachable (blob|commit) ' })
$unrBlobs = @($unreachable | Where-Object { $_ -match '^unreachable blob ' } | ForEach-Object { ($_ -split ' ')[2] })
$unrCommits = @($unreachable | Where-Object { $_ -match '^unreachable commit ' } | ForEach-Object { ($_ -split ' ')[2] })

$logArgs = @('log', '--all', '--reflog', '--root', '-m', '--raw', '--no-abbrev', '--no-renames', '--format=C %H')
if ($unrCommits.Count -gt 0) { $logArgs += $unrCommits }
$logArgs += '--'
$entries = @{}          # blob -> ordered map path -> introducing commit (oldest wins, log is newest first)
$allPaths = @{}         # path -> commit
$commits = New-Object System.Collections.Generic.List[string]
$cur = ''
foreach ($line in (G @logArgs)) {
  if ($line -like 'C *') { $cur = $line.Substring(2); if (-not $commits.Contains($cur)) { $commits.Add($cur) }; continue }
  if ($line -match '^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) (\w)\t(.+)$') {
    $blob = $Matches[1]; $path = $Matches[3]
    $allPaths[$path] = $cur
    if ($blob -match '^0+$') { continue }
    if (-not $entries.ContainsKey($blob)) { $entries[$blob] = @{} }
    $entries[$blob][$path] = $cur
  }
}
foreach ($b in $unrBlobs) { if (-not $entries.ContainsKey($b)) { $entries[$b] = @{ '(unreachable blob)' = '-' } } }
function Short([string]$sha) { if ($sha -eq '-' -or [string]::IsNullOrEmpty($sha)) { '-' } elseif ($sha -eq 'worktree') { 'worktree' } else { $sha.Substring(0, 7) } }

# ---------- identity values (from the environment at run time; never printed) ----------
$gitName = (G config user.name); $gitEmail = (G config user.email)
$rawIds = [ordered]@{
  'env-USERNAME'     = $env:USERNAME
  'env-USERPROFILE'  = $env:USERPROFILE
  'env-HOMEPATH'     = $env:HOMEPATH
  'env-COMPUTERNAME' = $env:COMPUTERNAME
  'git-user.name'    = $gitName
  'git-user.email'   = $gitEmail
}
$idPatterns = @()   # @{Kind; Regex}
$idSkipped = @()
foreach ($k in $rawIds.Keys) {
  $v = [string]$rawIds[$k]
  if ($v.Trim().Length -lt 3) { $idSkipped += $k; continue }
  $v = $v.Trim()
  $fwd = $v.Replace('\', '/')
  $variants = @($v, $fwd, $v.Replace('\', '\\'), [Uri]::EscapeDataString($v), [Uri]::EscapeDataString($fwd), $fwd.Replace(' ', '%20')) | Select-Object -Unique
  $alt = ($variants | ForEach-Object { [regex]::Escape($_) }) -join '|'
  $idPatterns += @{ Kind = $k; Regex = New-Object Text.RegularExpressions.Regex($alt, 'IgnoreCase') }
}

# ---------- secret patterns ----------
$CS = [Text.RegularExpressions.RegexOptions]::None
$CI = [Text.RegularExpressions.RegexOptions]::IgnoreCase
function P($name, $rx, $opt, $ph) { @{ Name = $name; Regex = New-Object Text.RegularExpressions.Regex($rx, $opt); Placeholder = $ph } }
$phValue = '^(.{1,7}$|\$|<|\{|%|\[|\(|\\|process\.|secrets\.|env\.|your|xxx|token$|REDACTED|\*)'
$secretPatterns = @(
  (P 'github-token'        '\bgh[pousr]_[A-Za-z0-9]{10,}' $CS $null),
  (P 'github-fine-grained' 'github_pat_[A-Za-z0-9_]{20,}' $CS $null),
  (P 'npm-token'           '\bnpm_[A-Za-z0-9]{30,}' $CS $null),
  (P 'aws-access-key-id'   '\bAKIA[0-9A-Z]{16}\b' $CS $null),
  (P 'aws-secret-key-name' 'aws_secret_access_key' $CI $null),
  (P 'private-key-block'   '-----BEGIN [A-Z ]*PRIVATE KEY-----' $CS $null),
  (P 'slack-token'         '\bxox[abprs]-[A-Za-z0-9-]{10,}' $CS $null),
  (P 'stripe-key'          '\b[sr]k_(live|test)_[A-Za-z0-9]{16,}' $CS $null),
  (P 'google-api-key'      '\bAIza[0-9A-Za-z_-]{35}' $CS $null),
  (P 'jwt-like'            'eyJ[A-Za-z0-9_-]{10,}\.eyJ' $CS $null),
  (P 'bearer-header'       'Authorization[''"]?[ \t]*:[ \t]*[''"]?Bearer[ \t]+(?<v>[^\s''"`]+)' $CI $phValue),
  (P 'kiro-github-env-assign' '(KIRO_API_KEY|GITHUB_TOKEN)[ \t]*[:=][ \t]*[''"]?(?<v>[^\s''"#]+)' $CS $phValue),
  (P 'generic-credential'  '(api[_-]?key|secret|token|password)[ \t]*[:=][ \t]*[''"]?(?<v>[A-Za-z0-9_\-]{16,})' $CI $null)
)
$fakeShape = New-Object Text.RegularExpressions.Regex('(fake|test|example|dummy|secret|placeholder|sample|mock|redact|x{4,}|0{4,}|1234|abcd|(.)\2{5,})', 'IgnoreCase')
$kiroAbs = New-Object Text.RegularExpressions.Regex('(?<abs>[A-Za-z]:[\\/]+(\\\\)?Users|/Users/|/home/[a-z]|\.kiro/sessions)|(?<sid>session[_-]?id)', 'IgnoreCase')
$absAny = New-Object Text.RegularExpressions.Regex('[A-Za-z]:[\\/]+(\\\\)?Users', 'IgnoreCase')

# results
$secretFindings = New-Object System.Collections.Generic.List[object]
$fakeCount = 0; $placeholderCount = 0
$identity = New-Object System.Collections.Generic.List[object]
$kiroFindings = New-Object System.Collections.Generic.List[object]
$absOther = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[object]
$binaryBlobs = 0; $scanned = 0

function Line-Of($nl, [int]$idx) { $k = $nl.BinarySearch($idx); if ($k -lt 0) { $k = -$k - 1 }; $k + 1 }

function Scan-Text([string]$text, [string]$path, [string]$sha) {
  $nl = New-Object System.Collections.Generic.List[int]
  $i = -1; while (($i = $text.IndexOf("`n", $i + 1)) -ge 0) { $nl.Add($i) }
  $isTest = $path -like 'tests/*'
  foreach ($p in $secretPatterns) {
    foreach ($m in $p.Regex.Matches($text)) {
      $val = if ($m.Groups['v'].Success) { $m.Groups['v'].Value } else { $m.Value }
      if ($p.Placeholder -and $val -match $p.Placeholder) { $script:placeholderCount++; continue }
      $class = 'unclassified'
      if ($isTest -and $fakeShape.IsMatch($val)) { $class = 'known fake test value' }
      if ($class -eq 'known fake test value') { $script:fakeCount++ }
      else { $script:secretFindings.Add([pscustomobject]@{ Pattern = $p.Name; Sha = (Short $sha); Path = $path; Line = (Line-Of $nl $m.Index) }) }
    }
  }
  foreach ($idp in $idPatterns) {
    $c = $idp.Regex.Matches($text).Count
    if ($c -gt 0) { $script:identity.Add([pscustomobject]@{ Kind = $idp.Kind; Sha = (Short $sha); Path = $path; Count = $c }) }
  }
  if ($path -like '.kiro/*') {
    foreach ($m in $kiroAbs.Matches($text)) { $script:kiroFindings.Add([pscustomobject]@{ Kind = $(if ($m.Groups['sid'].Success) { 'session-id field' } else { 'absolute local path' }); Sha = (Short $sha); Path = $path; Line = (Line-Of $nl $m.Index) }) }
  } else {
    $c = $absAny.Matches($text).Count
    if ($c -gt 0) { $script:absOther.Add([pscustomobject]@{ Sha = (Short $sha); Path = $path; Count = $c }) }
  }
}

# ---------- persistent git cat-file --batch ----------
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = 'git'; $psi.Arguments = 'cat-file --batch'
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true
$psi.CreateNoWindow = $true
$cat = [Diagnostics.Process]::Start($psi)
$catIn = $cat.StandardInput.BaseStream; $catOut = $cat.StandardOutput.BaseStream
function Read-HeaderLine {
  $sb = New-Object Text.StringBuilder
  while ($true) { $b = $catOut.ReadByte(); if ($b -lt 0 -or $b -eq 10) { break }; [void]$sb.Append([char]$b) }
  $sb.ToString()
}
function Read-Exact([int]$n) {
  $buf = New-Object byte[] $n; $off = 0
  while ($off -lt $n) { $r = $catOut.Read($buf, $off, $n - $off); if ($r -le 0) { throw 'cat-file closed' }; $off += $r }
  $buf
}
function Get-Blob([string]$sha) {
  $req = [Text.Encoding]::ASCII.GetBytes("$sha`n"); $catIn.Write($req, 0, $req.Length); $catIn.Flush()
  $h = Read-HeaderLine
  if ($h -match 'missing$') { return @{ Missing = $true } }
  $size = [int]($h.Split(' ')[2])
  if ($size -gt $MaxBlobBytes) {
    $left = $size + 1; $tmp = New-Object byte[] 65536
    while ($left -gt 0) { $r = $catOut.Read($tmp, 0, [Math]::Min($left, 65536)); if ($r -le 0) { break }; $left -= $r }
    return @{ Skipped = $true; Size = $size }
  }
  $buf = Read-Exact $size; [void](Read-Exact 1)
  @{ Bytes = $buf; Size = $size }
}

# ---------- scan every blob ----------
foreach ($blob in @($entries.Keys)) {
  $r = Get-Blob $blob
  $locs = $entries[$blob]
  if ($r.Missing) { continue }
  if ($r.Skipped) { foreach ($pth in $locs.Keys) { $skipped.Add([pscustomobject]@{ Sha = (Short $locs[$pth]); Path = $pth; Size = $r.Size }) }; continue }
  $scanned++
  $n = [Math]::Min(8000, $r.Bytes.Length)
  for ($j = 0; $j -lt $n; $j++) { if ($r.Bytes[$j] -eq 0) { $binaryBlobs++; break } }
  $text = $latin1.GetString($r.Bytes)
  foreach ($pth in $locs.Keys) { if ($pth -like 'spikes/secret-scan/*') { continue }; Scan-Text $text $pth $locs[$pth] }
}
$cat.StandardInput.Close(); $cat.WaitForExit()

# commit messages (same patterns)
foreach ($c in $commits) { $msg = (G log -1 --format=%B $c) -join "`n"; Scan-Text $msg '(commit message)' $c }

# ---------- category 2: env files ----------
$envRx = '(^|/)\.env(\..*)?$|(^|/)\.npmrc$|(^|/)\.netrc$|\.(pem|p12|pfx|key)$|(^|/)id_(rsa|ed25519|ecdsa)'
$template = '(^|/)\.env\.(example|sample|template)$'
$envEver = @($allPaths.Keys | Where-Object { $_ -match $envRx -and $_ -notmatch $template })
$envLogDot = @(G log --all --format=%h -- .env).Count
$envTemplateBad = New-Object System.Collections.Generic.List[object]
$envTemplateCommits = 0
foreach ($c in $commits) {
  $content = G show "${c}:.env.example"
  if ($LASTEXITCODE -ne 0 -or $null -eq $content) { continue }
  $envTemplateCommits++
  $ln = 0
  foreach ($l in @($content)) {
    $ln++
    if ($l -match '^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^\s#]') { $envTemplateBad.Add([pscustomobject]@{ Sha = (Short $c); Path = '.env.example'; Line = $ln }) }
  }
}
$envTemplateBad = @($envTemplateBad | Sort-Object Sha, Line -Unique)

# ---------- category 3b: authors / committers ----------
$ids = @(G log --all --reflog --format='%an|%ae|%cn|%ce')
$names = @{}; $emails = @{}
foreach ($l in $ids) { $f = $l.Split('|'); $names[$f[0]] = 1; $names[$f[2]] = 1; $emails[$f[1].ToLower()] = 1; $emails[$f[3].ToLower()] = 1 }
$domains = @{}
foreach ($e in $emails.Keys) { $d = if ($e.Contains('@')) { $e.Substring($e.IndexOf('@') + 1) } else { '(no domain)' }; $domains[$d] = 1 + [int]$domains[$d] }
$personalRx = '^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|aol|proton|protonmail|pm|gmx|yandex|msn|qq|163)\.'
$personalDomains = @($domains.Keys | Where-Object { $_ -match $personalRx })
$gitCfgInHistory = ($ids | Where-Object { $gitEmail -and $_.ToLower().Contains($gitEmail.ToLower()) }).Count

# ---------- category 4: large blobs and unexpected files ----------
$sizes = @(G cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname) %(objectsize)' | Where-Object { $_ -like 'blob *' } | ForEach-Object { $f = $_.Split(' '); [pscustomobject]@{ Sha = $f[1]; Size = [int64]$f[2] } })
$top = @($sizes | Sort-Object Size -Descending | Select-Object -First 20 | ForEach-Object {
  $loc = $entries[$_.Sha]; $pth = if ($loc) { ($loc.Keys | Select-Object -First 1) } else { '(not in any diff)' }
  [pscustomobject]@{ Sha = $_.Sha.Substring(0, 7); Size = $_.Size; Path = $pth } })
$unexpectedRx = '(^|/)(node_modules|\.next|dist|build|coverage)/|\.(tgz|tar|gz|zip|7z|exe|dll|log|sqlite3?|db|bak|map)$'
$unexpected = @($allPaths.Keys | Where-Object { $_ -match $unexpectedRx } | Sort-Object)
$kiroPathsEver = @($allPaths.Keys | Where-Object { $_ -like '.kiro/*' }).Count
$kiroSessionPaths = @($allPaths.Keys | Where-Object { $_ -match '^\.kiro/.*session' })

# ---------- category 5: working tree ----------
$envIgnored = $false; [void](G check-ignore -q .env); if ($LASTEXITCODE -eq 0) { $envIgnored = $true }
$envTracked = $true; [void](G ls-files --error-unmatch .env); if ($LASTEXITCODE -ne 0) { $envTracked = $false }
$status = @(G status --short --ignored)
$cnt = @{ untracked = 0; ignored = 0; modified = 0 }
foreach ($s in $status) { if ($s.StartsWith('??')) { $cnt.untracked++ } elseif ($s.StartsWith('!!')) { $cnt.ignored++ } else { $cnt.modified++ } }
$untracked = @(G ls-files --others --exclude-standard)
$modified = @((G diff --name-only) + (G diff --cached --name-only) | Sort-Object -Unique)
$tracked = @(G ls-files)
$sensRx = '(^|/)\.env($|\.)|\.npmrc$|\.netrc$|\.(pem|p12|pfx|key)$|id_(rsa|ed25519)|secret|credential|token'
$sensUntracked = @($untracked | Where-Object { $_ -match $sensRx -and $_ -notmatch $template -and $_ -notmatch '^spikes/secret-scan/' })
$sensTracked = @($tracked | Where-Object { $_ -match $sensRx -and $_ -notmatch $template })
$ignoredNames = @($status | Where-Object { $_.StartsWith('!!') } | ForEach-Object { $_.Substring(3) })
$wtSecretBefore = $secretFindings.Count
$wtFiles = @($untracked + $modified | Where-Object { $_ -and $_ -notmatch '^spikes/secret-scan/' -and $_ -notmatch '^\.env$' } | Select-Object -Unique)
$wtScanned = 0
foreach ($f in $wtFiles) {
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
  $fi = Get-Item -LiteralPath $f; if ($fi.Length -gt $MaxBlobBytes) { continue }
  $wtScanned++
  Scan-Text ($latin1.GetString([IO.File]::ReadAllBytes($fi.FullName))) $f 'worktree'
}

# ---------- verdicts ----------
$secUnclassified = $secretFindings.Count
$cat1 = if ($secUnclassified -eq 0) { 'no findings' } else { "findings: $secUnclassified" }
$cat2n = $envEver.Count + $envTemplateBad.Count
$cat2 = if ($cat2n -eq 0) { 'no findings' } else { "findings: $cat2n" }
$idFiles = @($identity | Select-Object -ExpandProperty Path -Unique).Count
$cat3 = if ($identity.Count -eq 0) { 'no findings' } else { "findings: $($identity.Count) (kind, file, commit) rows in $idFiles distinct files; user must judge" }
$cat4n = $kiroFindings.Count + $kiroSessionPaths.Count + $unexpected.Count + $skipped.Count
$cat4 = if ($cat4n -eq 0) { 'no findings' } else { "findings: $cat4n" }
$cat5n = $sensUntracked.Count + $sensTracked.Count + $(if ($envIgnored -and -not $envTracked) { 0 } else { 1 })
$cat5 = if ($cat5n -eq 0) { 'no findings' } else { "findings: $cat5n" }

# ---------- output ----------
$sb = New-Object Text.StringBuilder
function W([string]$s = '') { [void]$sb.AppendLine($s); Write-Host $s }
W '# Secret scan report'
W ''
W "- Date: $($started.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
W "- Git HEAD: $headShort"
W '- Command: `powershell -NoProfile -File spikes/secret-scan/scan.ps1` (from the repository root; `pwsh spikes/secret-scan/scan.ps1` also works where PowerShell 7 is installed)'
W "- Scan duration: $([int]((Get-Date) - $started).TotalSeconds) s"
W "- External scanners used: $(if ($external.Count) { $external -join ', ' } else { 'none installed (gitleaks, trufflehog not found); built-in patterns only' })"
W "- Coverage: $($commits.Count) commits (all refs, reflog, unreachable), $($entries.Count) distinct blobs ($scanned scanned, $binaryBlobs binary-looking, $($skipped.Count) skipped as larger than $MaxBlobBytes bytes), commit messages, $wtScanned uncommitted working-tree files"
W "- Branches/tags/stashes: $(@(G branch -a).Count) branch refs, $(@(G tag).Count) tags, $(@(G stash list).Count) stashes; unreachable objects: $($unreachable.Count)"
W '- Output rule: no matched value, user name, e-mail, computer name or home path is written here.'
W ''
W '## Verdicts'
W ''
W '| # | Category | Verdict |'
W '|---|----------|---------|'
W "| 1 | Secrets by pattern | $cat1 (plus $fakeCount known fake test values in tests/, $placeholderCount placeholders ignored) |"
W "| 2 | .env files and .env.example | $cat2 |"
W "| 3 | Personal identity in blobs | $cat3 |"
W "| 4 | Large/binary blobs, unexpected files, .kiro local paths | $cat4 |"
W "| 5 | Working tree | $cat5 |"
W ''
W '## 1. Secrets by pattern'
W ''
W "Unclassified findings: $secUnclassified. Known fake test values (path under tests/ and fake-shaped value: contains fake/test/example/dummy/secret/placeholder/sample/mock, a run of x or 0, 1234, abcd, or one repeated character): $fakeCount."
if ($secretFindings.Count) { W ''; W '| Pattern | Commit | File | Line |'; W '|---|---|---|---|'; foreach ($f in ($secretFindings | Sort-Object Pattern, Path, Line)) { W "| $($f.Pattern) | $($f.Sha) | $($f.Path) | $($f.Line) |" } }
W ''
W '## 2. .env files'
W ''
W "- Env-like or key-like paths ever added or touched in history (templates excluded): $($envEver.Count)"
foreach ($p in $envEver) { W "  - $p (commit $(Short $allPaths[$p]))" }
W "- Commits touching exactly `.env` (`git log --all -- .env`): $envLogDot"
W "- Commits containing `.env.example`: $envTemplateCommits; with a non-empty value: $($envTemplateBad.Count)"
foreach ($b in $envTemplateBad) { W "  - $($b.Sha) .env.example line $($b.Line)" }
W ''
W '## 3. Personal identity'
W ''
W "- Identity sources compared (values not shown): $(($rawIds.Keys | Where-Object { $idSkipped -notcontains $_ }) -join ', '); skipped as too short or empty: $(if ($idSkipped.Count) { $idSkipped -join ', ' } else { 'none' })"
W '- Variants searched, case-insensitive: raw, forward slashes, escaped back-slashes, percent-encoded.'
if ($identity.Count) {
  W ''; W 'One row per source and file, over all commits (and the working tree) that contain a match:'; W ''
  W '| Source | File | Versions with a match | Newest commit | Max matches in one version |'; W '|---|---|---|---|---|'
  foreach ($g in ($identity | Group-Object Kind, Path | Sort-Object Name)) {
    $first = $g.Group[0]
    $mx = ($g.Group | Measure-Object Count -Maximum).Maximum
    W "| $($first.Kind) | $($first.Path) | $($g.Count) | $($first.Sha) | $mx |"
  }
}
W ''
W "- Distinct author and committer names: $($names.Count) (<name-1> .. <name-$($names.Count)>)"
W "- Distinct author and committer e-mail addresses: $($emails.Count)"
W "- E-mail domains: $((($domains.Keys | Sort-Object) | ForEach-Object { "$_ ($($domains[$_]))" }) -join ', ')"
W "- Personal-looking domains: $(if ($personalDomains.Count) { 'yes: ' + ($personalDomains -join ', ') } else { 'no' })"
W "- History lines using the e-mail from the current git config: $gitCfgInHistory"
W ''
W '## 4. Large blobs and unexpected files'
W ''
W '20 largest blobs:'
W ''
W '| Blob | Bytes | First path |'
W '|---|---|---|'
foreach ($t in $top) { W "| $($t.Sha) | $($t.Size) | $($t.Path) |" }
W ''
W "- Paths ever in history matching archive/log/build patterns: $($unexpected.Count)"
foreach ($u in $unexpected) { W "  - $u (commit $(Short $allPaths[$u]))" }
W "- Blobs skipped for size: $($skipped.Count)"
W "- Paths under .kiro/ ever committed: $kiroPathsEver; session-like paths: $($kiroSessionPaths.Count)"
foreach ($u in $kiroSessionPaths) { W "  - $u" }
W "- Absolute local paths or session ids inside .kiro/ files: $($kiroFindings.Count) hits"
foreach ($g in ($kiroFindings | Group-Object Kind, Path | Sort-Object Name)) {
  $lines = @($g.Group | ForEach-Object { $_.Line } | Sort-Object -Unique)
  $shown = ($lines | Select-Object -First 8) -join ', '
  W "  - $($g.Group[0].Kind): $($g.Group[0].Path), $($g.Count) hits in $(@($g.Group | ForEach-Object { $_.Sha } | Sort-Object -Unique).Count) versions, $($lines.Count) distinct lines (first: $shown)"
}
W "- Informational: files outside .kiro/ containing a drive-letter Users path: $($absOther.Count) files (judge: may be test examples)"
foreach ($f in ($absOther | Sort-Object Path)) { W "  - $($f.Sha) $($f.Path) ($($f.Count))" }
W ''
W '## 5. Working tree'
W ''
W "- .env is ignored: $envIgnored; .env is tracked: $envTracked"
W "- git status summary: $($cnt.modified) modified/staged, $($cnt.untracked) untracked-not-ignored entries, $($cnt.ignored) ignored entries"
W "- Ignored entries (names): $($ignoredNames -join ', ')"
W "- Untracked-not-ignored files: $($untracked.Count)"
foreach ($u in $untracked) { W "  - $u" }
W "- Modified tracked files: $($modified.Count)"
foreach ($u in $modified) { W "  - $u" }
W "- Sensitive-looking names among untracked-not-ignored: $($sensUntracked.Count); among tracked: $($sensTracked.Count)"
foreach ($u in ($sensUntracked + $sensTracked)) { W "  - $u" }
W "- Uncommitted files content-scanned: $wtScanned (spikes/secret-scan/ excluded; .env never read)"

W ''
W '## Recommendations (generated from the verdicts above)'
W ''
$n = 0
if ($secUnclassified -gt 0) { $n++; W "$n. Review the $secUnclassified unclassified secret-pattern rows in section 1. If any is a real credential: STOP, rotate it first, then choose between (a) rotate and accept the history as is (the revoked value is harmless) or (b) rewrite history with git filter-repo (for example --replace-text or --invert-paths on the file), force-push, and have every clone re-cloned. Not run by this scan." }
if ($envEver.Count + $envTemplateBad.Count -gt 0) { $n++; W "$n. Remove or empty the .env-like paths or .env.example values from section 2 and rotate any value that was real." }
if ($identity.Count -gt 0) { $n++; W "$n. Review section 3: rows naming a home path or computer name are the ones worth fixing going forward (edit the file in a new commit; old versions stay in history). A match on the short user name alone may be a generic word." }
if ($personalDomains.Count -gt 0) { $n++; W "$n. Commit e-mails with a personal domain become public with the repo. If that is not wanted, set a GitHub no-reply address for new commits (git config user.email <id>+<login>@users.noreply.github.com, and the GitHub setting 'Keep my email addresses private'). Old commits keep the old address unless history is rewritten (git filter-repo --mailmap), which this scan does not recommend without a real secret." }
if ($kiroFindings.Count -gt 0) { $n++; W "$n. Section 4 lists .kiro/ files with session ids or local paths. Decide whether to keep them; for new commits, regenerate or strip those fields. Old versions stay in history." }
if ($unexpected.Count -gt 0) { $n++; W "$n. Confirm that each archive/log/build path in section 4 is intended (the recorded lodash.set tarball is a test fixture)." }
if (-not ($envIgnored -and -not $envTracked)) { $n++; W "$n. .env must be ignored and untracked: fix .gitignore / git rm --cached." }
if ($sensUntracked.Count -gt 0) { $n++; W "$n. Untracked files with sensitive-looking names (section 5): add them to .gitignore or review them before committing." }
if ($n -eq 0) { W 'No action needed.' }
W ''
W 'Limits: pattern based, no entropy analysis; text is matched as ISO-8859-1, so non-ASCII UTF-8 identity values and UTF-16 files are not matched; blobs above the size limit are listed, not scanned; no external scanner ran unless listed above.'
[IO.File]::WriteAllText($ReportPath, $sb.ToString(), (New-Object Text.UTF8Encoding $false))
Write-Host "`nReport written to $ReportPath ."
