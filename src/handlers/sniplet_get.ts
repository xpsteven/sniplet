// PRD §8 GET / on {slug}.sniplet.page + §7.7 private flow.
//
// Authorisation invariant (§7.20): every request re-loads meta.viewers[].h and
// compares to the cookie's `sub` HMAC. No memoisation — PATCH-removed viewers
// MUST lose access on the next request.

import type { Env } from "../types.ts";
import {
  SESSION_COOKIE_NAME,
  SNIPLET_TTL_SECONDS,
} from "../constants.ts";
import { sha256Hex } from "../lib/crypto.ts";
import { normalizeIP } from "../lib/normalize.ts";
import { readHtml, readMeta } from "../lib/r2.ts";
import { hmacSha256Hex as _unused } from "../lib/crypto.ts";
import { getClientIP } from "../lib/req.ts";
import { securityHeaders } from "../lib/headers.ts";
import { slugFromHost } from "../lib/slug.ts";
import { verifyJwt } from "../lib/jwt.ts";
import { challengePageResponse } from "../pages/challenge.ts";
import { notFoundPage } from "../pages/notfound.ts";
import { track } from "../lib/analytics.ts";

void _unused;

export async function handleSnipletGet(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" || url.pathname !== "/") return notFoundPage();

  const slug = slugFromHost(url.hostname);
  if (!slug) return notFoundPage();

  const meta = await readMeta(env.SNIPLETS, slug);
  if (!meta) {
    await track404(env, req);
    return notFoundPage();
  }

  // PRD §7.21: lazy expiry check; expired sniplet = 404 (not 410), to avoid
  // leaking "this slug existed".
  const expiresMs = new Date(meta.expires_at).getTime();
  if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
    await track404(env, req);
    return notFoundPage();
  }

  const accessMode = meta.viewers ? "email-gated" : "public";

  // ---- Public sniplet ----
  if (!meta.viewers) {
    const html = await readHtml(env.SNIPLETS, slug);
    if (html === null) return notFoundPage();
    track(env.ANALYTICS, "sniplet_viewed", { blobs: [accessMode, "public"] });
    return new Response(html, {
      status: 200,
      headers: securityHeaders({
        csp: "sniplet",
        contentType: "text/html; charset=utf-8",
        cacheControl: "no-store, no-transform",
      }),
    });
  }

  // ---- Email-gated sniplet ----
  const sub = await verifySessionCookie(req, env);
  const allowed = sub !== null && meta.viewers.some((v) => v.h === sub);
  if (allowed) {
    const html = await readHtml(env.SNIPLETS, slug);
    if (html === null) return notFoundPage();
    track(env.ANALYTICS, "sniplet_viewed", { blobs: [accessMode, "authorized"] });
    return new Response(html, {
      status: 200,
      headers: securityHeaders({
        csp: "sniplet",
        contentType: "text/html; charset=utf-8",
        cacheControl: "no-store, no-transform",
      }),
    });
  }

  // Show challenge.
  track(env.ANALYTICS, "sniplet_viewed", { blobs: [accessMode, "challenge"] });
  const ttlDaysRemaining = (expiresMs - Date.now()) / (24 * 60 * 60 * 1000);
  return challengePageResponse({
    ttlDaysRemaining,
    returnTo: `https://${slug}.sniplet.page/`,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  });
}

async function verifySessionCookie(req: Request, env: Env): Promise<string | null> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  if (!token) return null;
  const ver = await verifyJwt(token, env.SESSION_JWT_SECRET, {
    expectedPurpose: "session",
  });
  if (!ver.ok) return null;
  return ver.claims.sub;
}

function readCookieValue(header: string, name: string): string | null {
  // Minimal cookie parser — we only ever read one cookie.
  const parts = header.split(";");
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim();
    if (key === name) return p.slice(eq + 1).trim();
  }
  return null;
}

async function track404(env: Env, req: Request): Promise<void> {
  // F-42: hashed-IP enumeration signal.
  const ip = normalizeIP(getClientIP(req));
  const ipHash = await sha256Hex(ip + env.IP_HASH_SECRET);
  track(env.ANALYTICS, "sniplet_404_miss", { blobs: [ipHash] });
}

// Re-export to avoid unused-locals — SNIPLET_TTL_SECONDS may be referenced by
// future logic for max-age on cached views; keep import path stable.
void SNIPLET_TTL_SECONDS;
