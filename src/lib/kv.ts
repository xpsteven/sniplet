// KV wrappers — rate limit counters + email reverse index + magic consumed.
// PRD §7.10, §7.17. KV eventually consistent; documented in F-8 / F-41.

import { hmacSha256Hex } from "./crypto.ts";

// ---------- Email reverse index (PRD §7.10) ----------

export interface EmailIndexEntry {
  slugs: string[];
}

export function emailIndexKey(emailHmacHex: string): string {
  return `viewer:${emailHmacHex}`;
}

export async function addToEmailIndex(
  kv: KVNamespace,
  emailHmacHex: string,
  slug: string,
  ttlSeconds: number,
): Promise<void> {
  const key = emailIndexKey(emailHmacHex);
  const existing = await kv.get<EmailIndexEntry>(key, "json");
  const slugs = existing?.slugs ?? [];
  if (!slugs.includes(slug)) slugs.push(slug);
  await kv.put(key, JSON.stringify({ slugs } satisfies EmailIndexEntry), {
    expirationTtl: ttlSeconds,
  });
}

export async function removeFromEmailIndex(
  kv: KVNamespace,
  emailHmacHex: string,
  slug: string,
): Promise<void> {
  const key = emailIndexKey(emailHmacHex);
  const existing = await kv.get<EmailIndexEntry>(key, "json");
  if (!existing) return;
  const slugs = existing.slugs.filter((s) => s !== slug);
  if (slugs.length === 0) {
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify({ slugs } satisfies EmailIndexEntry));
  }
}

export async function lookupEmailIndex(
  kv: KVNamespace,
  emailHmacHex: string,
): Promise<EmailIndexEntry | null> {
  return kv.get<EmailIndexEntry>(emailIndexKey(emailHmacHex), "json");
}

// ---------- Counters (per-IP / per-email / global) ----------
// PRD §7.17 — fixed window, GET → +1 → PUT (non-atomic, accepted trade-off).

export async function incrCounter(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
): Promise<number> {
  const cur = (await kv.get(key)) ?? "0";
  const next = (parseInt(cur, 10) || 0) + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSeconds });
  return next;
}

export async function peekCounter(kv: KVNamespace, key: string): Promise<number> {
  const cur = await kv.get(key);
  return cur ? parseInt(cur, 10) || 0 : 0;
}

// ---------- Key builders ----------
// All counters scoped per UTC day (or per-hour/minute as documented).

export async function ipQuotaKey(
  ipHashSecret: string,
  normalizedIp: string,
  date: string,
): Promise<string> {
  const h = await hmacSha256Hex(ipHashSecret, normalizedIp);
  return `ip_quota:${h}:${date}`;
}

export async function rlAuthIpKey(
  ipHashSecret: string,
  normalizedIp: string,
  date: string,
): Promise<string> {
  const h = await hmacSha256Hex(ipHashSecret, normalizedIp);
  return `rl_auth_ip:${h}:${date}`;
}

export async function rlEmailHourKey(emailHmacHex: string, hourBucket: string): Promise<string> {
  return `rl_email:${emailHmacHex}:${hourBucket}`;
}

export async function rlEmailDayKey(emailHmacHex: string, date: string): Promise<string> {
  return `rl_email:${emailHmacHex}:${date}`;
}

export async function rlCspIpKey(
  ipHashSecret: string,
  normalizedIp: string,
  minuteBucket: string,
): Promise<string> {
  const h = await hmacSha256Hex(ipHashSecret, normalizedIp);
  return `rl_csp:${h}:${minuteBucket}`;
}

export const dailySnipletCapKey = (date: string) => `daily_count:${date}`;
export const authSendDailyCapKey = (date: string) => `auth_send_daily:${date}`;

// ---------- Magic link one-shot (PRD §8 /auth/consume) ----------

export const magicConsumedKey = (jti: string) => `consumed:${jti}`;

export async function checkAndMarkConsumed(
  kv: KVNamespace,
  jti: string,
  ttlSeconds: number,
): Promise<"fresh" | "already_consumed"> {
  const existing = await kv.get(magicConsumedKey(jti));
  if (existing !== null) return "already_consumed";
  await kv.put(magicConsumedKey(jti), "1", { expirationTtl: ttlSeconds });
  return "fresh";
}
