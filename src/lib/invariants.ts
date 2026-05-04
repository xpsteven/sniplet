// PRD §8.0 — common POST invariants enforced before body parsing.
//   - Content-Type allowlist (F-37) blocks <form enctype="text/plain"> CSRF.
//   - Origin enforcement (F-30, F-35) blocks session-fixation CSRF.

import { POSTFIXED_SLUG_HOST_RE } from "./slug.ts";
import { errorResponse } from "./errors.ts";

export function checkContentType(req: Request, allowed: readonly string[]): Response | null {
  const ct = req.headers.get("content-type") ?? "";
  // Strip parameters (e.g. "; charset=utf-8") for comparison.
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!allowed.includes(base)) {
    return errorResponse(400, "invalid_content_type", "Unsupported Content-Type");
  }
  return null;
}

export type OriginRule =
  | { kind: "exact"; value: string }
  | { kind: "snipletDomain" } // apex OR any *.sniplet.page postfixed subdomain
  | { kind: "apexOnly" };

export function checkOrigin(req: Request, rules: OriginRule[]): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return errorResponse(400, "invalid_origin", "Missing Origin header");

  for (const rule of rules) {
    if (rule.kind === "exact" && origin === rule.value) return null;
    if (rule.kind === "apexOnly" && origin === "https://sniplet.page") return null;
    if (rule.kind === "snipletDomain") {
      if (origin === "https://sniplet.page") return null;
      const host = origin.replace(/^https:\/\//, "");
      if (POSTFIXED_SLUG_HOST_RE.test(host)) return null;
    }
  }
  return errorResponse(400, "invalid_origin", "Origin not permitted");
}
