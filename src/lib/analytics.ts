// Analytics Engine writer — PRD §7.18 + §7.22 logging hygiene.
//
// Rules: NEVER write owner_token, JWTs, plaintext emails, plaintext IPs,
// HTML content, magic tokens, or any other secret/PII. Use HMAC/SHA-256
// hashes for correlation when needed.

import { todayUTC } from "./req.ts";

export type EventName =
  | "sniplet_created"
  | "sniplet_viewed"
  | "auth_request_received"
  | "auth_verified"
  | "auth_consumed"
  | "slug_postfix_applied"
  | "rate_limit_hit"
  | "daily_cap_hit"
  | "auth_global_cap_hit"
  | "resend_send_failed"
  | "cron_cleanup_success"
  | "csp_violation"
  | "sniplet_404_miss"
  | "sniplet_mutated"
  | "csp_report_rate_limited";

interface WriteOpts {
  blobs?: (string | undefined | null)[];
  doubles?: number[];
  indexes?: string[];
}

export function track(
  ds: AnalyticsEngineDataset | undefined,
  event: EventName,
  opts: WriteOpts = {},
): void {
  // Defensive: tolerate a missing binding so the Worker can deploy before
  // Analytics Engine is enabled at the account level. Once enabled, restore
  // the binding in wrangler.toml — no code change needed.
  if (!ds) return;
  const blobs = [event, ...(opts.blobs ?? [])].map((b) =>
    b === undefined || b === null ? "" : String(b),
  );
  const doubles = opts.doubles ?? [];
  const indexes = opts.indexes ?? [todayUTC()];
  ds.writeDataPoint({ blobs, doubles, indexes });
}
