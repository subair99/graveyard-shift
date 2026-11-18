// Static route parameters of crypt/[name] (crypt-ui Requirement 1.6, amended 2026-11-18). Pure.

import { EMPTY_CRYPT_PARAM } from "./site";

/** The entry names, or the single placeholder parameter when the site has no entry (an empty array fails `next build`). */
export function staticParamsFor(view: { readonly entries: readonly { readonly name: string }[] }): { name: string }[] {
  if (view.entries.length === 0) return [{ name: EMPTY_CRYPT_PARAM }];
  return view.entries.map((e) => ({ name: e.name }));
}
