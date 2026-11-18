// Safe_Link filter (crypt-ui Requirements 7.2, 7.3). Pure.

/**
 * The string itself when it is an absolute http(s) URL with a host and no control or whitespace
 * character; otherwise null. The returned href is the input string, unchanged.
 */
export function safeHref(value: string): string | null {
  // Any code point below U+0021, U+007F, or Unicode whitespace anywhere in the string.
  if (/[\u0000-\u0020\u007F\s]/u.test(value)) return null;
  // Checked before any parsing or percent-decoding: rejects scheme-less, protocol-relative, other schemes.
  if (!/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return value;
}
