// Author credits of a package.json: `author` plus `contributors`, string or object form,
// normalized so that the same person written two ways compares equal.

export interface AuthorCredit {
  readonly name: string;
  readonly email: string;
  readonly url: string;
}

function norm(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseAuthorString(text: string): AuthorCredit {
  // "Name <email> (url)", every part optional.
  let rest = text;
  let email = "";
  let url = "";
  const emailMatch = /<([^>]*)>/.exec(rest);
  if (emailMatch) {
    email = emailMatch[1] ?? "";
    rest = rest.replace(emailMatch[0], " ");
  }
  const urlMatch = /\(([^)]*)\)/.exec(rest);
  if (urlMatch) {
    url = urlMatch[1] ?? "";
    rest = rest.replace(urlMatch[0], " ");
  }
  return { name: norm(rest), email: norm(email), url: norm(url) };
}

function toCredit(value: unknown): AuthorCredit | null {
  let credit: AuthorCredit | null = null;
  if (typeof value === "string") {
    credit = parseAuthorString(value);
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    credit = { name: norm(o.name), email: norm(o.email), url: norm(o.url) };
  }
  if (credit === null) return null;
  return credit.name === "" && credit.email === "" && credit.url === "" ? null : credit;
}

export function creditKey(credit: AuthorCredit): string {
  return JSON.stringify([credit.name, credit.email, credit.url]);
}

/** All credits of `pkg` (`author` and `contributors`), normalized, without duplicates. */
export function collectAuthorCredits(pkg: Readonly<Record<string, unknown>>): AuthorCredit[] {
  const raw: unknown[] = [];
  if (pkg.author !== undefined) raw.push(pkg.author);
  if (Array.isArray(pkg.contributors)) raw.push(...(pkg.contributors as unknown[]));
  const seen = new Set<string>();
  const out: AuthorCredit[] = [];
  for (const item of raw) {
    const credit = toCredit(item);
    if (credit === null) continue;
    const key = creditKey(credit);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(credit);
  }
  return out;
}

/** Credits of `original` that `resurrection` lacks. */
export function missingAuthorCredits(
  original: Readonly<Record<string, unknown>>,
  resurrection: Readonly<Record<string, unknown>>,
): AuthorCredit[] {
  const have = new Set(collectAuthorCredits(resurrection).map(creditKey));
  return collectAuthorCredits(original).filter((c) => !have.has(creditKey(c)));
}
