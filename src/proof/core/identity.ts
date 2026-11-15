/**
 * Identity_Values, Identity_Scanner and the string-level Identity_Redactor
 * (Requirements 13.25 to 13.27, decision D10, limitation L14).
 *
 * Pure functions. The module reads no environment, no clock and no file
 * system: the caller passes a snapshot of the environment and the platform.
 * The scanner (`findIdentity`) and the redactor (`redactIdentity`) share one
 * matcher (`scanIdentity`), so the scanner finds exactly what the redactor
 * replaces. The deep redaction over encoded nodes lives in `redact.ts` (6.2).
 *
 * Matching rules (Requirement 13.27):
 * - Path-valued values (USERPROFILE, HOMEPATH, HOME) are matched in the native,
 *   forward-slash, back-slash, escaped (doubled) back-slash, `\\?\` and
 *   percent-encoded `file://` forms, longest form first (ties by code point),
 *   case-insensitively on Windows. A match must be followed by the end of the
 *   string or by a character that cannot continue a directory name (anything
 *   but a letter, digit, `.`, `_`, `-`, `~`; `/` and `\` qualify). A match
 *   becomes `<user-home>`.
 * - USERNAME is matched case-insensitively on Windows only. With at least 4
 *   characters and not in GENERIC_USER_NAMES it is matched as a whole word
 *   (neighbours are not a letter, digit, `_` or `-`) and in path context. A
 *   shorter or generic name is matched only in path context: a complete path
 *   segment preceded by `/`, `\`, `%2F` or `%5C`. A match becomes `<user>`.
 *   The generic list is compared case-insensitively on every platform.
 * - A bare short or generic name outside a path is NOT matched (L14).
 * - Text inside the placeholders themselves is never matched, so
 *   `redactIdentity` is idempotent.
 */

export type Platform = 'win32' | 'posix';

export interface IdentityValues {
  /** USERPROFILE, HOMEPATH, HOME: non-empty, not only separators, deduplicated. */
  readonly pathValues: readonly string[];
  /** USERNAME, non-empty. */
  readonly userName: string | undefined;
}

export interface IdentityMatch {
  readonly kind: 'home' | 'user';
  /** UTF-16 offset of the match in the scanned text. */
  readonly index: number;
  /** UTF-16 length of the match. */
  readonly length: number;
}

/** Where identity values occur. Carries offsets only, never the matched text. */
export interface IdentityFinding {
  readonly found: boolean;
  readonly matches: readonly IdentityMatch[];
}

export const USER_HOME_PLACEHOLDER = '<user-home>';
export const USER_PLACEHOLDER = '<user>';

/**
 * Names that are matched only in path context, whatever their length
 * (Requirement 13.27 (b)). Compared case-insensitively.
 */
export const GENERIC_USER_NAMES: readonly string[] = [
  'admin',
  'administrator',
  'default',
  'guest',
  'owner',
  'public',
  'root',
  'system',
  'test',
  'user',
];

/** Minimum length (in code points) for matching a USERNAME as a whole word. */
export const MIN_WORD_MATCH_LENGTH = 4;

/**
 * True when `userName` may be matched as a whole word outside a path: at least
 * 4 characters and not in the generic list. Otherwise it is matched only in
 * path context (L14).
 */
export function isWordMatchableUserName(userName: string): boolean {
  return (
    Array.from(userName).length >= MIN_WORD_MATCH_LENGTH &&
    !GENERIC_USER_NAMES.includes(userName.toLowerCase())
  );
}

const SEPARATORS_ONLY = /^[/\\]*$/;
const BARE_DRIVE = /^[A-Za-z]:$/;

function lookupEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: Platform,
): string | undefined {
  const exact = env[name];
  if (exact !== undefined || platform !== 'win32') return exact;
  const lower = name.toLowerCase();
  for (const key of Object.keys(env).sort()) {
    if (key.toLowerCase() === lower) return env[key];
  }
  return undefined;
}

/**
 * Builds Identity_Values from an environment snapshot. Empty values and values
 * made only of path separators are ignored.
 */
export function identityValuesFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  platform: Platform,
): IdentityValues {
  const pathValues: string[] = [];
  for (const name of ['USERPROFILE', 'HOMEPATH', 'HOME']) {
    const value = lookupEnv(env, name, platform);
    if (value === undefined || value === '' || SEPARATORS_ONLY.test(value)) continue;
    if (!pathValues.includes(value)) pathValues.push(value);
  }
  const rawName = lookupEnv(env, 'USERNAME', platform);
  return {
    pathValues,
    userName: rawName === undefined || rawName === '' ? undefined : rawName,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const cx = x[i]?.codePointAt(0) ?? 0;
    const cy = y[i]?.codePointAt(0) ?? 0;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  return x.length - y.length;
}

interface PathForm {
  readonly text: string;
  readonly url: boolean;
}

function encodeUrlPath(forwardSlashPath: string): string | undefined {
  try {
    return forwardSlashPath
      .split('/')
      .map((segment) => (BARE_DRIVE.test(segment) ? segment : encodeURIComponent(segment)))
      .join('/');
  } catch {
    // A lone surrogate cannot be encoded; skip the URL form for this value.
    return undefined;
  }
}

/** Every form of one path-valued Identity_Value (Requirement 13.19 plus the escaped form). */
function formsOfPathValue(value: string): PathForm[] {
  const trimmed = value.replace(/[/\\]+$/, '');
  if (trimmed === '' || BARE_DRIVE.test(trimmed)) return [];
  const forward = trimmed.replace(/\\/g, '/');
  const back = trimmed.replace(/\//g, '\\');
  const forms: PathForm[] = [
    { text: trimmed, url: false },
    { text: forward, url: false },
    { text: back, url: false },
    { text: back.replace(/\\/g, '\\\\'), url: false },
  ];
  if (/^[A-Za-z]:/.test(back)) {
    forms.push({ text: `\\\\?\\${back}`, url: false });
    forms.push({ text: `\\\\\\\\?\\\\${back.replace(/\\/g, '\\\\')}`, url: false });
  }
  const encoded = encodeUrlPath(forward);
  if (encoded !== undefined) {
    if (/^[A-Za-z]:/.test(forward)) forms.push({ text: `file:///${encoded}`, url: true });
    else forms.push({ text: `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`, url: true });
  }
  return forms;
}

const NAME_BOUNDARY = '(?![A-Za-z0-9._~-])';
const URL_BOUNDARY = '(?:(?![A-Za-z0-9._~%-])|(?=%(?:2[Ff]|5[Cc])))';

interface Matcher {
  readonly home: RegExp | undefined;
  readonly user: RegExp | undefined;
}

function buildHomeRegExp(pathValues: readonly string[], platform: Platform): RegExp | undefined {
  const seen = new Set<string>();
  const forms: PathForm[] = [];
  for (const value of pathValues) {
    for (const form of formsOfPathValue(value)) {
      const key = `${form.url ? 'u' : 'p'}${form.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      forms.push(form);
    }
  }
  if (forms.length === 0) return undefined;
  forms.sort((a, b) => b.text.length - a.text.length || compareCodePoints(a.text, b.text));
  const alternatives = forms.map((form) => {
    let source = escapeRegExp(form.text);
    if (form.url && platform !== 'win32') {
      // Hexadecimal digits of percent escapes match in either case.
      source = source.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => {
        const classes = Array.from(hex)
          .map((d) => (/[A-Fa-f]/.test(d) ? `[${d.toLowerCase()}${d.toUpperCase()}]` : d))
          .join('');
        return `%${classes}`;
      });
    }
    return `${source}${form.url ? URL_BOUNDARY : NAME_BOUNDARY}`;
  });
  return new RegExp(`(?:${alternatives.join('|')})`, platform === 'win32' ? 'gi' : 'g');
}

function buildUserRegExp(userName: string | undefined, platform: Platform): RegExp | undefined {
  if (userName === undefined || userName === '') return undefined;
  const name = escapeRegExp(userName);
  const pathContext = `(?<=[/\\\\]|%2[Ff]|%5[Cc])${name}(?:${NAME_BOUNDARY}|(?=%2[Ff]|%5[Cc]))`;
  const word = `(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`;
  const source = isWordMatchableUserName(userName) ? `(?:${pathContext}|${word})` : pathContext;
  return new RegExp(source, platform === 'win32' ? 'gi' : 'g');
}

const matcherCache = new WeakMap<IdentityValues, Partial<Record<Platform, Matcher>>>();

function matcherFor(identity: IdentityValues, platform: Platform): Matcher {
  let perPlatform = matcherCache.get(identity);
  if (perPlatform === undefined) {
    perPlatform = {};
    matcherCache.set(identity, perPlatform);
  }
  let matcher = perPlatform[platform];
  if (matcher === undefined) {
    matcher = {
      home: buildHomeRegExp(identity.pathValues, platform),
      user: buildUserRegExp(identity.userName, platform),
    };
    perPlatform[platform] = matcher;
  }
  return matcher;
}

function overlaps(start: number, end: number, blocked: readonly IdentityMatch[]): boolean {
  return blocked.some((b) => start < b.index + b.length && b.index < end);
}

/**
 * The shared matcher. Returns the non-overlapping matches in text order.
 * Path-valued matches come first; the USERNAME is then matched outside them.
 * Text inside the placeholders is never matched.
 */
export function scanIdentity(
  text: string,
  identity: IdentityValues,
  platform: Platform,
): IdentityFinding {
  const matcher = matcherFor(identity, platform);
  const placeholders: IdentityMatch[] = [];
  for (const m of text.matchAll(/<user-home>|<user>/g)) {
    placeholders.push({ kind: 'home', index: m.index, length: m[0].length });
  }
  const matches: IdentityMatch[] = [];
  if (matcher.home !== undefined) {
    for (const m of text.matchAll(matcher.home)) {
      if (overlaps(m.index, m.index + m[0].length, placeholders)) continue;
      matches.push({ kind: 'home', index: m.index, length: m[0].length });
    }
  }
  if (matcher.user !== undefined) {
    const blocked = [...placeholders, ...matches];
    for (const m of text.matchAll(matcher.user)) {
      if (overlaps(m.index, m.index + m[0].length, blocked)) continue;
      matches.push({ kind: 'user', index: m.index, length: m[0].length });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return { found: matches.length > 0, matches };
}

/** Identity_Scanner (backstop): whether and where an Identity_Value occurs. */
export function findIdentity(
  text: string,
  identity: IdentityValues,
  platform: Platform,
): IdentityFinding {
  return scanIdentity(text, identity, platform);
}

/**
 * Identity_Redactor on one string: path-valued matches become `<user-home>`,
 * USERNAME matches become `<user>`. Idempotent.
 */
export function redactIdentity(text: string, identity: IdentityValues, platform: Platform): string {
  const { matches } = scanIdentity(text, identity, platform);
  if (matches.length === 0) return text;
  let out = '';
  let pos = 0;
  for (const m of matches) {
    out += text.slice(pos, m.index);
    out += m.kind === 'home' ? USER_HOME_PLACEHOLDER : USER_PLACEHOLDER;
    pos = m.index + m.length;
  }
  return out + text.slice(pos);
}

/**
 * A message about a finding. It states counts only, never an Identity_Value
 * and never the text that was scanned.
 */
export function describeIdentityFinding(finding: IdentityFinding): string {
  const home = finding.matches.filter((m) => m.kind === 'home').length;
  const user = finding.matches.filter((m) => m.kind === 'user').length;
  return `identity value found: ${home} home-directory match(es), ${user} user-name match(es)`;
}
