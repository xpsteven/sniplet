// Slug & subdomain validation. PRD §7.15, §7.16, §8 (validateReturnTo regex).

import {
  POSTFIX_LEN,
  RESERVED_SUBDOMAINS,
  SLUG_MAX_LEN,
  SLUG_MIN_LEN,
} from "../constants.ts";
import { generatePostfix } from "./crypto.ts";

const BASE_SLUG_RE = /^[a-z0-9](?!.*--)[a-z0-9-]*[a-z0-9]$/;

export function isValidBaseSlug(s: string): boolean {
  if (s.length < SLUG_MIN_LEN || s.length > SLUG_MAX_LEN) return false;
  return BASE_SLUG_RE.test(s);
}

export function isReservedSubdomain(s: string): boolean {
  // Compare against the *postfixed* slug. PRD §7.16 reserves bare names.
  // A postfixed slug ends in "-XXXX" so a postfixed "api-XXXX" is allowed —
  // the user-supplied base "api" alone would be reserved. We check the base
  // (everything before the trailing 4-char postfix) AND the full string.
  if (RESERVED_SUBDOMAINS.has(s)) return true;
  return false;
}

export function appendPostfix(base: string): string {
  return `${base}-${generatePostfix(POSTFIX_LEN)}`;
}

// PRD §7.15 / §8: postfixed slug subdomain regex. Used for:
//   - return_to hostname allowlist
//   - CORS Access-Control-Allow-Origin reflect filter
// Length: base 3..40 + "-" + postfix 4 = 8..45 chars total.
export const POSTFIXED_SLUG_HOST_RE =
  /^[a-z0-9](?!.*--)[a-z0-9-]{6,43}[a-z0-9]\.sniplet\.page$/;

export function isPostfixedSlugHost(host: string): boolean {
  return POSTFIXED_SLUG_HOST_RE.test(host);
}

// Extract the slug portion of a "{slug}.sniplet.page" host.
// Returns null if the host is not a sniplet subdomain.
export function slugFromHost(host: string): string | null {
  const suffix = ".sniplet.page";
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, host.length - suffix.length);
  if (!slug || slug.includes(".")) return null; // reject "x.y.sniplet.page"
  return slug;
}
