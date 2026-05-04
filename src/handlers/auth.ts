// PRD §8 — /auth/request, /auth/verify, /auth/consume, /auth/logout.

import type { Env } from "../types.ts";
import {
  AUTH_SEND_DAILY_CAP,
  MAGIC_CONSUMED_TTL_SECONDS,
  MAGIC_TTL_SECONDS,
  PER_EMAIL_AUTH_DAILY,
  PER_EMAIL_AUTH_HOURLY,
  PER_IP_AUTH_DAILY,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../constants.ts";
import { errorResponse } from "../lib/errors.ts";
import { checkContentType, checkOrigin } from "../lib/invariants.ts";
import {
  base64urlEncode,
  hmacSha256Hex,
  randomBytes,
} from "../lib/crypto.ts";
import { signJwt, verifyJwt, type JwtClaims } from "../lib/jwt.ts";
import { isValidEmail, normalizeEmail, normalizeIP } from "../lib/normalize.ts";
import { getClientIP, parseJsonBody, readBodyCapped } from "../lib/req.ts";
import { todayUTC } from "../lib/req.ts";
import {
  authSendDailyCapKey,
  checkAndMarkConsumed,
  dailySnipletCapKey as _unused1,
  incrCounter,
  lookupEmailIndex,
  peekCounter,
  rlAuthIpKey,
  rlEmailDayKey,
  rlEmailHourKey,
} from "../lib/kv.ts";
import { safeReturnTo, validateReturnTo } from "../lib/returnTo.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";
import { sendResendEmail } from "../lib/resend.ts";
import { track } from "../lib/analytics.ts";
import { verifyPageResponse } from "../pages/verify.ts";

void _unused1;

interface AuthRequestBody {
  email?: unknown;
  return_to?: unknown;
  turnstile_token?: unknown;
}

const FROM_EMAIL = "sniplet.page <noreply@sniplet.page>";

// PRD §10.1: challenge page submits to /auth/request via cross-origin fetch.
// CORS reflects sniplet.page or any postfixed *.sniplet.page subdomain.
function buildCorsHeaders(origin: string | null): Headers {
  const h = new Headers();
  if (!origin) return h;
  const re = /^https:\/\/(?:[a-z0-9](?!.*--)[a-z0-9-]{6,43}[a-z0-9]\.sniplet\.page|sniplet\.page)$/;
  if (re.test(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Vary", "Origin");
  }
  return h;
}

export function handleAuthRequestOptions(req: Request): Response {
  const origin = req.headers.get("origin");
  const cors = buildCorsHeaders(origin);
  cors.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  cors.set("Access-Control-Allow-Headers", "content-type");
  cors.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers: cors });
}

export async function handleAuthRequest(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);
  const respond = (res: Response): Response => {
    corsHeaders.forEach((v, k) => res.headers.set(k, v));
    return res;
  };

  // §8.0 invariants. Origin is enforced via CORS reflection above; mismatched
  // origins simply won't get CORS headers and the browser will block the JS.
  // We still enforce Content-Type as a defence-in-depth.
  const ctErr = checkContentType(req, ["application/json"]);
  if (ctErr) return respond(ctErr);

  const body = await readBodyCapped(req, 16 * 1024);
  if ("tooLarge" in body) {
    return respond(errorResponse(400, "invalid_format", "Body too large"));
  }
  const parsed = await parseJsonBody<AuthRequestBody>(body.text);
  if (!parsed.ok) return respond(parsed.res);
  const b = parsed.value;

  if (typeof b.email !== "string" || typeof b.turnstile_token !== "string") {
    return respond(errorResponse(400, "invalid_format", "Missing fields"));
  }
  const email = normalizeEmail(b.email);
  if (!isValidEmail(email)) {
    return respond(errorResponse(400, "invalid_format", "Invalid email"));
  }
  const returnToCandidate =
    typeof b.return_to === "string" ? b.return_to : "https://sniplet.page/";
  const returnTo = safeReturnTo(returnToCandidate);

  const clientIP = getClientIP(req);
  const ip = normalizeIP(clientIP);

  // 1. Turnstile.
  const ts = await verifyTurnstile(env.TURNSTILE_SECRET, b.turnstile_token, clientIP);
  if (!ts.success) {
    return respond(errorResponse(400, "turnstile_failed", "Turnstile verification failed"));
  }

  // 2. Per-email + per-IP rate limits.
  const date = todayUTC();
  const hourBucket = date + "-" + String(new Date().getUTCHours()).padStart(2, "0");
  const emailHmac = await hmacSha256Hex(env.EMAIL_HASH_SECRET, email);

  const ipDayKey = await rlAuthIpKey(env.IP_HASH_SECRET, ip, date);
  const ipDayCount = (await peekCounter(env.METER_KV, ipDayKey)) + 1;
  if (ipDayCount > PER_IP_AUTH_DAILY) {
    track(env.ANALYTICS, "rate_limit_hit", {
      blobs: ["/auth/request", "per-ip", "daily"],
    });
    return respond(errorResponse(429, "rate_limited", "Per-IP daily limit"));
  }

  const emailHourKey = await rlEmailHourKey(emailHmac, hourBucket);
  const emailDayKey = await rlEmailDayKey(emailHmac, date);
  const emailHourCount = (await peekCounter(env.METER_KV, emailHourKey)) + 1;
  if (emailHourCount > PER_EMAIL_AUTH_HOURLY) {
    track(env.ANALYTICS, "rate_limit_hit", {
      blobs: ["/auth/request", "per-email", "hourly"],
    });
    return respond(errorResponse(429, "rate_limited", "Per-email hourly limit"));
  }
  const emailDayCount = (await peekCounter(env.METER_KV, emailDayKey)) + 1;
  if (emailDayCount > PER_EMAIL_AUTH_DAILY) {
    track(env.ANALYTICS, "rate_limit_hit", {
      blobs: ["/auth/request", "per-email", "daily"],
    });
    return respond(errorResponse(429, "rate_limited", "Per-email daily limit"));
  }

  // Bump per-IP / per-email counters now (cheap; mismatched cap isn't a
  // security concern — this is cost protection).
  await incrCounter(env.METER_KV, ipDayKey, 26 * 60 * 60);
  await incrCounter(env.METER_KV, emailHourKey, 70 * 60);
  await incrCounter(env.METER_KV, emailDayKey, 26 * 60 * 60);

  // 3. F-32 — global send cap PEEK before whitelist lookup. Both hit and miss
  // paths must see this same gate to preserve Strategy C timing parity.
  const sendCount = await peekCounter(env.METER_KV, authSendDailyCapKey(date));
  if (sendCount >= AUTH_SEND_DAILY_CAP) {
    track(env.ANALYTICS, "auth_global_cap_hit", { doubles: [sendCount] });
    return respond(errorResponse(503, "service_unavailable", "Auth temporarily unavailable"));
  }

  // 4. Whitelist lookup + defer Resend send.
  const idx = await lookupEmailIndex(env.EMAIL_INDEX_KV, emailHmac);
  const wasOnWhitelist = !!idx && idx.slugs.length > 0;
  track(env.ANALYTICS, "auth_request_received", {
    blobs: [String(wasOnWhitelist)],
  });

  if (wasOnWhitelist) {
    // Sign a magic JWT (server-trusted return_to lives in the claim).
    const now = Math.floor(Date.now() / 1000);
    const jti = base64urlEncode(randomBytes(16));
    const claims: JwtClaims = {
      sub: emailHmac,
      purpose: "magic",
      iat: now,
      exp: now + MAGIC_TTL_SECONDS,
      v: 1,
      jti,
      return_to: returnTo,
    };
    const token = await signJwt(claims, env.MAGIC_JWT_SECRET);
    const verifyUrl = `https://sniplet.page/auth/verify?t=${encodeURIComponent(token)}`;
    const text = magicEmailText(verifyUrl);
    const html = magicEmailHtml(verifyUrl);

    ctx.waitUntil(
      (async () => {
        const send = await sendResendEmail(env.RESEND_API_KEY, {
          from: FROM_EMAIL,
          to: email,
          subject: "Sign in to sniplet.page",
          text,
          html,
        });
        if (!send.ok) {
          track(env.ANALYTICS, "resend_send_failed", {
            blobs: [send.errorCode ?? `http_${send.status}`, "false"],
          });
          // Don't increment send counter on failure.
          return;
        }
        await incrCounter(env.METER_KV, authSendDailyCapKey(date), 26 * 60 * 60);
      })(),
    );
  }

  return respond(jsonResponse(200, { status: "sent" }));
}

// PRD §8 GET /auth/verify — display only, never consumes.
export function handleAuthVerify(_req: Request, _env: Env, _ctx: ExecutionContext): Response {
  return verifyPageResponse();
}

interface AuthConsumeBody {
  t?: unknown;
  // F-36: body `r` is intentionally not trusted.
}

export async function handleAuthConsume(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // F-37 + F-35.
  const ctErr = checkContentType(req, ["application/json"]);
  if (ctErr) return ctErr;
  const originErr = checkOrigin(req, [{ kind: "apexOnly" }]);
  if (originErr) return originErr;

  const body = await readBodyCapped(req, 16 * 1024);
  if ("tooLarge" in body) {
    return errorResponse(400, "invalid_format", "Body too large");
  }
  const parsed = await parseJsonBody<AuthConsumeBody>(body.text);
  if (!parsed.ok) return parsed.res;
  if (typeof parsed.value.t !== "string") {
    return errorResponse(400, "invalid_format", "Missing t");
  }

  // Verify magic JWT.
  const ver = await verifyJwt(parsed.value.t, env.MAGIC_JWT_SECRET, {
    expectedPurpose: "magic",
  });
  if (!ver.ok) {
    track(env.ANALYTICS, "auth_consumed", {
      blobs: ["invalid", ver.reason],
    });
    if (ver.reason === "expired") {
      return errorResponse(410, "token_expired", "Token expired");
    }
    return errorResponse(401, "invalid_token", "Token invalid");
  }
  const claims = ver.claims;
  if (typeof claims.jti !== "string" || claims.jti.length === 0) {
    return errorResponse(401, "invalid_token", "Token missing jti");
  }

  // One-shot replay check.
  const consumed = await checkAndMarkConsumed(
    env.MAGIC_CONSUMED_KV,
    claims.jti,
    MAGIC_CONSUMED_TTL_SECONDS,
  );
  if (consumed === "already_consumed") {
    track(env.ANALYTICS, "auth_consumed", { blobs: ["replay"] });
    return errorResponse(422, "already_consumed", "Token already consumed");
  }

  // F-36: return_to comes only from the JWT claim.
  const claimReturn = typeof claims.return_to === "string" ? claims.return_to : "";
  const returnTo = validateReturnTo(claimReturn) ? claimReturn : "https://sniplet.page/";

  // Sign session JWT.
  const now = Math.floor(Date.now() / 1000);
  const sessionClaims: JwtClaims = {
    sub: claims.sub,
    purpose: "session",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    v: 1,
  };
  const sessionToken = await signJwt(sessionClaims, env.SESSION_JWT_SECRET);

  track(env.ANALYTICS, "auth_consumed", { blobs: ["success"] });

  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Domain=sniplet.page; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
  );
  return new Response(JSON.stringify({ redirect: returnTo }), { status: 200, headers });
}

export function handleAuthLogout(req: Request, _env: Env, _ctx: ExecutionContext): Response {
  // F-30: must validate Origin since SameSite=Lax doesn't block logout CSRF.
  const originErr = checkOrigin(req, [{ kind: "snipletDomain" }]);
  if (originErr) return originErr;

  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Domain=sniplet.page; Path=/; Max-Age=0`,
  );
  return new Response(JSON.stringify({ status: "logged_out" }), { status: 200, headers });
}

// ---------- helpers ----------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function magicEmailText(verifyUrl: string): string {
  return `Someone shared a sniplet with you on sniplet.page.

View it here:
${verifyUrl}

This link expires in 15 minutes and can only be used once.
If you didn't request this, safely ignore this email.

— sniplet.page
`;
}

function magicEmailHtml(verifyUrl: string): string {
  // Simple system-font, max-width 560 — PRD §9.
  const safeUrl = verifyUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f9;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:12px;">
  <tr><td>
    <div style="font-size:.85rem;color:#888;">sniplet.page</div>
    <h1 style="font-size:1.25rem;margin:1rem 0 .5rem;">Sign in to view a sniplet</h1>
    <p style="color:#555;line-height:1.55;">Someone shared a sniplet with you. Click the button below to view it.</p>
    <p style="margin:1.5rem 0;"><a href="${safeUrl}" style="display:inline-block;padding:.75rem 1.25rem;background:#111;color:#fff;text-decoration:none;border-radius:8px;">View sniplet</a></p>
    <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0;">
    <p style="color:#888;font-size:.85rem;">This link expires in 15 minutes and can only be used once. If you didn't request this, safely ignore this email.</p>
    <p style="color:#aaa;font-size:.75rem;margin-top:1.5rem;">sniplet.page</p>
  </td></tr>
</table>
</body></html>`;
}
