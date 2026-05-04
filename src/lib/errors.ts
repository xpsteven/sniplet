// PRD §16 — unified JSON error envelope.

export type ErrorCode =
  | "invalid_content_type"
  | "invalid_origin"
  | "invalid_format"
  | "invalid_token"
  | "reserved_slug"
  | "viewers_exceeded"
  | "viewers_empty"
  | "empty_request"
  | "rate_limited"
  | "blocked_content"
  | "slug_retry_exhausted"
  | "daily_cap_exceeded"
  | "service_unavailable"
  | "turnstile_failed"
  | "token_expired"
  | "already_consumed"
  | "expired"
  | "payload_too_large"
  | "not_found";

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const body: Record<string, unknown> = { error: code, message };
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
