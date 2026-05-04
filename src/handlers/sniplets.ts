// PRD §8 — POST/PATCH/DELETE /v1/sniplets[/...]
//
// Order of checks (POST):
//   1. §8.0 Content-Type
//   2. Body size cap (1MB) + JSON parse
//   3. Body schema (slug / html / viewers)
//   4. Daily global cap (peek)            ← 503 daily_cap_exceeded
//   5. Per-IP daily cap (incr)            ← 429 rate_limited
//   6. Reserved slug check                ← 400 reserved_slug
//   7. Postfix retry loop with R2 create-only
//   8. Write meta.json + email index
//   9. Analytics + response

import type { Env } from "../types.ts";
import type { SnipletMeta, ViewerEntry } from "../types.ts";
import {
  DAILY_SNIPLET_CAP,
  HTML_MAX_BYTES,
  PER_IP_SNIPLET_DAILY,
  POSTFIX_RETRY_MAX,
  SNIPLET_TTL_SECONDS,
  VIEWERS_MAX,
} from "../constants.ts";
import { errorResponse } from "../lib/errors.ts";
import { checkContentType } from "../lib/invariants.ts";
import {
  generateOwnerToken,
  generatePostfix,
  hmacSha256Hex,
  sha256Hex,
} from "../lib/crypto.ts";
import { timingSafeEqualHex } from "../lib/timingSafe.ts";
import { normalizeIP } from "../lib/normalize.ts";
import { getClientIP, parseJsonBody, readBodyCapped, todayUTC } from "../lib/req.ts";
import {
  appendPostfix,
  isReservedSubdomain,
  isValidBaseSlug,
} from "../lib/slug.ts";
import {
  R2Collision,
  deleteSniplet,
  overwriteMeta,
  putHtmlCreateOnly,
  putMetaCreateOnly,
  readMeta,
} from "../lib/r2.ts";
import {
  addToEmailIndex,
  authSendDailyCapKey as _unusedAuthCapKey,
  dailySnipletCapKey,
  incrCounter,
  ipQuotaKey,
  peekCounter,
  removeFromEmailIndex,
} from "../lib/kv.ts";
import {
  entriesToMaskedList,
  normalizeViewerList,
  viewersToEntries,
} from "../lib/viewers.ts";
import { track } from "../lib/analytics.ts";

// Quiet TS noUnusedLocals — kept import to make the API surface explicit.
void _unusedAuthCapKey;

// SHA-256 hex of a fixed string, used as a dummy hash for constant-time compare
// when the slug is not found (PRD §8 F-33: prevents enumeration via timing).
const DUMMY_OWNER_HASH_PREIMAGE = "sniplet-dummy-owner-hash-preimage";
let _dummyOwnerHashCache: string | null = null;
async function dummyOwnerHash(): Promise<string> {
  if (_dummyOwnerHashCache) return _dummyOwnerHashCache;
  _dummyOwnerHashCache = await sha256Hex(DUMMY_OWNER_HASH_PREIMAGE);
  return _dummyOwnerHashCache;
}

interface PostBody {
  html?: unknown;
  slug?: unknown;
  viewers?: unknown;
}

const RANDOM_SLUG_LEN = 8;

export async function handlePostSniplet(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // §8.0 invariants.
  const ctErr = checkContentType(req, ["application/json"]);
  if (ctErr) return ctErr;

  // 1MB body cap.
  const body = await readBodyCapped(req, HTML_MAX_BYTES + 16 * 1024); // small JSON overhead
  if ("tooLarge" in body) {
    return errorResponse(400, "invalid_format", "Request body exceeds 1MB");
  }

  const parsed = await parseJsonBody<PostBody>(body.text);
  if (!parsed.ok) return parsed.res;
  const b = parsed.value;

  // html — required string, raw size ≤ 1MB.
  if (typeof b.html !== "string") {
    return errorResponse(400, "invalid_format", "html must be a string");
  }
  if (new TextEncoder().encode(b.html).byteLength > HTML_MAX_BYTES) {
    return errorResponse(400, "invalid_format", "html exceeds 1MB");
  }

  // slug — optional string; if missing, server-generated random.
  let baseSlug: string;
  if (b.slug === undefined || b.slug === null) {
    baseSlug = randomBaseSlug(RANDOM_SLUG_LEN);
  } else if (typeof b.slug !== "string") {
    return errorResponse(400, "invalid_format", "slug must be a string");
  } else {
    baseSlug = b.slug;
    if (!isValidBaseSlug(baseSlug)) {
      return errorResponse(400, "invalid_format", "slug format invalid");
    }
  }

  // viewers — optional. null/undefined = public; [] explicitly rejected.
  let viewerEntries: ViewerEntry[] | null = null;
  if (b.viewers !== undefined && b.viewers !== null) {
    if (!Array.isArray(b.viewers)) {
      return errorResponse(400, "invalid_format", "viewers must be an array of emails or null");
    }
    if (b.viewers.length === 0) {
      return errorResponse(400, "viewers_empty", "Pass null instead of [] for public sniplet");
    }
    if (b.viewers.length > VIEWERS_MAX) {
      return errorResponse(400, "viewers_exceeded", `viewers max ${VIEWERS_MAX}`);
    }
    if (!b.viewers.every((v): v is string => typeof v === "string")) {
      return errorResponse(400, "invalid_format", "viewers must contain only strings");
    }
    const norm = await normalizeViewerList(env.EMAIL_HASH_SECRET, b.viewers);
    if (!norm.ok) return errorResponse(400, "invalid_format", "viewer email format invalid");
    viewerEntries = viewersToEntries(norm.viewers);
  }

  // Reserved check on base slug.
  if (isReservedSubdomain(baseSlug)) {
    return errorResponse(400, "reserved_slug", "slug is reserved");
  }

  // Daily global cap (peek).
  const date = todayUTC();
  const globalCount = await peekCounter(env.METER_KV, dailySnipletCapKey(date));
  if (globalCount >= DAILY_SNIPLET_CAP) {
    track(env.ANALYTICS, "daily_cap_hit");
    return errorResponse(503, "daily_cap_exceeded", "Daily site-wide cap reached");
  }

  // Per-IP daily cap.
  const clientIP = getClientIP(req);
  const ipKey = await ipQuotaKey(env.IP_HASH_SECRET, normalizeIP(clientIP), date);
  const ipCount = (await peekCounter(env.METER_KV, ipKey)) + 1;
  if (ipCount > PER_IP_SNIPLET_DAILY) {
    track(env.ANALYTICS, "rate_limit_hit", {
      blobs: ["/v1/sniplets", "per-ip", "daily"],
    });
    return errorResponse(429, "rate_limited", "Per-IP daily quota reached");
  }

  // Postfix retry loop with R2 create-only.
  const ownerToken = generateOwnerToken();
  const ownerTokenHash = await sha256Hex(ownerToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SNIPLET_TTL_SECONDS * 1000);
  const ipHash = await hmacSha256Hex(env.IP_HASH_SECRET, normalizeIP(clientIP));

  let finalSlug: string | null = null;
  let attempts = 0;
  for (let i = 0; i < POSTFIX_RETRY_MAX; i++) {
    attempts = i + 1;
    const candidate = appendPostfix(baseSlug);
    // Even though postfixed names can't equal reserved single words, run the
    // check anyway — keeps spec literal.
    if (isReservedSubdomain(candidate)) continue;
    try {
      await putHtmlCreateOnly(env.SNIPLETS, candidate, b.html);
      const meta: SnipletMeta = {
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        ip_hash: ipHash,
        owner_token_hash: ownerTokenHash,
        viewers: viewerEntries,
      };
      try {
        await putMetaCreateOnly(env.SNIPLETS, candidate, meta);
      } catch (e) {
        // Roll back the html if meta collides — unlikely, but keeps R2 clean.
        if (e instanceof R2Collision) {
          await deleteSniplet(env.SNIPLETS, candidate);
          continue;
        }
        throw e;
      }
      finalSlug = candidate;
      break;
    } catch (e) {
      if (e instanceof R2Collision) continue;
      throw e;
    }
  }
  if (!finalSlug) {
    return errorResponse(500, "slug_retry_exhausted", "Could not allocate unique slug");
  }

  // Increment counters (best-effort, after success).
  await incrCounter(env.METER_KV, dailySnipletCapKey(date), 26 * 60 * 60);
  await incrCounter(env.METER_KV, ipKey, 26 * 60 * 60);

  // EMAIL_INDEX_KV updates for viewers.
  if (viewerEntries) {
    for (const v of viewerEntries) {
      await addToEmailIndex(env.EMAIL_INDEX_KV, v.h, finalSlug, SNIPLET_TTL_SECONDS);
    }
  }

  // Analytics.
  const country = req.cf?.country as string | undefined;
  const accessMode = viewerEntries ? "email-gated" : "public";
  track(env.ANALYTICS, "sniplet_created", {
    blobs: [accessMode, country ?? ""],
    doubles: [b.html.length],
  });
  if (attempts > 1) {
    track(env.ANALYTICS, "slug_postfix_applied", { blobs: [String(attempts)] });
  }

  return jsonResponse(200, {
    slug: finalSlug,
    url: `https://${finalSlug}.sniplet.page`,
    expires_at: expiresAt.toISOString(),
    owner_token: ownerToken,
    access: accessMode,
    viewers_masked: viewerEntries ? entriesToMaskedList(viewerEntries) : null,
  });
}

// PATCH /v1/sniplets/:slug/viewers — F-33 verification order.
interface PatchBody {
  add?: unknown;
  remove?: unknown;
}

export async function handlePatchViewers(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  slug: string,
): Promise<Response> {
  const ctErr = checkContentType(req, ["application/json"]);
  if (ctErr) return ctErr;

  // Auth header parse.
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = /^Bearer\s+(.+)$/.exec(authHeader);
  const presentedToken = tokenMatch ? tokenMatch[1]! : "";

  const meta = await readMeta(env.SNIPLETS, slug);

  // Constant-time hash compare (F-33). Use dummy hash on missing slug to
  // equalise latency.
  const presentedHash = await sha256Hex(presentedToken);
  const expectedHash = meta?.owner_token_hash ?? (await dummyOwnerHash());
  const tokenOk = !!presentedToken && timingSafeEqualHex(presentedHash, expectedHash) && !!meta;
  if (!tokenOk) {
    return errorResponse(401, "invalid_token", "Authentication failed");
  }

  // From here on, meta is non-null AND token verified.
  const m = meta!;
  if (new Date(m.expires_at).getTime() <= Date.now()) {
    return errorResponse(410, "expired", "sniplet expired");
  }

  const body = await readBodyCapped(req, 64 * 1024);
  if ("tooLarge" in body) {
    return errorResponse(400, "invalid_format", "PATCH body too large");
  }
  const parsed = await parseJsonBody<PatchBody>(body.text);
  if (!parsed.ok) return parsed.res;
  const b = parsed.value;

  const addList = b.add;
  const removeList = b.remove;
  const addArr = Array.isArray(addList) ? addList : [];
  const removeArr = Array.isArray(removeList) ? removeList : [];
  if (addArr.length === 0 && removeArr.length === 0) {
    return errorResponse(400, "empty_request", "Provide add or remove");
  }
  if (!addArr.every((v): v is string => typeof v === "string")) {
    return errorResponse(400, "invalid_format", "add must be strings");
  }
  if (!removeArr.every((v): v is string => typeof v === "string")) {
    return errorResponse(400, "invalid_format", "remove must be strings");
  }

  // Compute current viewers map (HMAC → entry).
  const current = new Map<string, ViewerEntry>();
  for (const v of m.viewers ?? []) current.set(v.h, v);

  // Apply removes first.
  if (removeArr.length > 0) {
    const removeNorm = await normalizeViewerList(env.EMAIL_HASH_SECRET, removeArr);
    if (!removeNorm.ok) return errorResponse(400, "invalid_format", "remove email format invalid");
    for (const r of removeNorm.viewers) {
      if (current.delete(r.hmacHex)) {
        await removeFromEmailIndex(env.EMAIL_INDEX_KV, r.hmacHex, slug);
      }
    }
  }

  // Apply adds.
  if (addArr.length > 0) {
    const addNorm = await normalizeViewerList(env.EMAIL_HASH_SECRET, addArr);
    if (!addNorm.ok) return errorResponse(400, "invalid_format", "add email format invalid");
    for (const a of addNorm.viewers) {
      if (!current.has(a.hmacHex)) {
        current.set(a.hmacHex, { h: a.hmacHex, m: a.masked });
      }
    }
  }

  if (current.size > VIEWERS_MAX) {
    return errorResponse(400, "viewers_exceeded", `viewers max ${VIEWERS_MAX}`);
  }

  const nextViewers = current.size === 0 ? null : Array.from(current.values());
  const expiresEpoch = Math.floor((new Date(m.expires_at).getTime() - Date.now()) / 1000);
  const remainingTtl = Math.max(60, expiresEpoch);
  const next: SnipletMeta = { ...m, viewers: nextViewers };
  await overwriteMeta(env.SNIPLETS, slug, next);

  // Add new viewers to KV index (removes were already done above).
  if (nextViewers) {
    for (const v of nextViewers) {
      await addToEmailIndex(env.EMAIL_INDEX_KV, v.h, slug, remainingTtl);
    }
  }

  // F-42 audit event.
  const slugHash = await sha256Hex(slug);
  track(env.ANALYTICS, "sniplet_mutated", { blobs: ["patch", slugHash] });

  return jsonResponse(200, {
    viewers_masked: nextViewers ? nextViewers.map((v) => v.m) : null,
    access: nextViewers ? "email-gated" : "public",
  });
}

// DELETE /v1/sniplets/:slug
export async function handleDeleteSniplet(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  slug: string,
): Promise<Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = /^Bearer\s+(.+)$/.exec(authHeader);
  const presentedToken = tokenMatch ? tokenMatch[1]! : "";

  const meta = await readMeta(env.SNIPLETS, slug);
  const presentedHash = await sha256Hex(presentedToken);
  const expectedHash = meta?.owner_token_hash ?? (await dummyOwnerHash());
  const tokenOk = !!presentedToken && timingSafeEqualHex(presentedHash, expectedHash) && !!meta;
  if (!tokenOk) {
    return errorResponse(401, "invalid_token", "Authentication failed");
  }
  const m = meta!;
  if (new Date(m.expires_at).getTime() <= Date.now()) {
    return errorResponse(410, "expired", "sniplet expired");
  }

  await deleteSniplet(env.SNIPLETS, slug);
  if (m.viewers) {
    for (const v of m.viewers) {
      await removeFromEmailIndex(env.EMAIL_INDEX_KV, v.h, slug);
    }
  }

  const slugHash = await sha256Hex(slug);
  track(env.ANALYTICS, "sniplet_mutated", { blobs: ["delete", slugHash] });

  return new Response(null, { status: 204 });
}

// ---------- helpers ----------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function randomBaseSlug(len: number): string {
  // Same alphabet as postfix; uses crypto.getRandomValues via generatePostfix.
  return generatePostfix(len);
}
