// PRD §8 POST /v1/csp-report — F-40 (rate limit + body cap + CT allowlist).

import type { Env } from "../types.ts";
import {
  CSP_REPORT_BODY_MAX_BYTES,
  CSP_REPORT_PER_IP_PER_MIN,
} from "../constants.ts";
import { errorResponse } from "../lib/errors.ts";
import { sha256Hex } from "../lib/crypto.ts";
import { normalizeIP } from "../lib/normalize.ts";
import { getClientIP, readBodyCapped } from "../lib/req.ts";
import { incrCounter, rlCspIpKey } from "../lib/kv.ts";
import { track } from "../lib/analytics.ts";

const ACCEPTED_CTS = ["application/csp-report", "application/json"];

interface CspReport {
  "csp-report"?: {
    "blocked-uri"?: string;
    "blocked_host"?: string;
    "violated-directive"?: string;
  };
}

export async function handleCspReport(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // 1. Content-Type allowlist.
  const ct = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ACCEPTED_CTS.includes(ct)) {
    return errorResponse(400, "invalid_content_type", "Unsupported Content-Type");
  }

  // 2. Body cap (8KB).
  const body = await readBodyCapped(req, CSP_REPORT_BODY_MAX_BYTES);
  if ("tooLarge" in body) {
    return errorResponse(413, "payload_too_large", "csp-report exceeds 8KB");
  }

  // 3. Per-IP per-minute rate limit.
  const ip = normalizeIP(getClientIP(req));
  const minute = minuteBucket();
  const key = await rlCspIpKey(env.IP_HASH_SECRET, ip, minute);
  const count = await incrCounter(env.METER_KV, key, 90); // 90s TTL covers the bucket
  if (count > CSP_REPORT_PER_IP_PER_MIN) {
    const ipHash = await sha256Hex(ip + env.IP_HASH_SECRET);
    track(env.ANALYTICS, "csp_report_rate_limited", { blobs: [ipHash] });
    return errorResponse(429, "rate_limited", "csp-report rate limit exceeded");
  }

  // 4. Body schema crude validation.
  let parsed: CspReport;
  try {
    parsed = JSON.parse(body.text) as CspReport;
  } catch {
    return errorResponse(400, "invalid_format", "Malformed JSON");
  }
  const reportObj = parsed["csp-report"];
  if (!reportObj || (!reportObj["blocked-uri"] && !reportObj["blocked_host"])) {
    return errorResponse(400, "invalid_format", "Missing csp-report fields");
  }

  // 5. Hash blocked-uri, write event.
  const blocked = reportObj["blocked-uri"] ?? reportObj["blocked_host"] ?? "";
  const blockedHash = blocked ? await sha256Hex(blocked) : "";
  const directive = reportObj["violated-directive"] ?? "";
  track(env.ANALYTICS, "csp_violation", { blobs: [directive, blockedHash] });

  return new Response(null, { status: 204 });
}

function minuteBucket(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}-${min}`;
}
