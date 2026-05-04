// PRD §6, §7, §8 — Free tier constants.

export const HTML_MAX_BYTES = 1_048_576; // 1 MB (PRD §7.8)
export const VIEWERS_MAX = 3; // PRD §6 Free tier
export const SLUG_MIN_LEN = 3;
export const SLUG_MAX_LEN = 40;
export const POSTFIX_LEN = 4;
export const POSTFIX_RETRY_MAX = 5;
export const SNIPLET_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const SESSION_COOKIE_NAME = "st";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (PRD §7.13)
export const MAGIC_TTL_SECONDS = 15 * 60; // 15 min
export const MAGIC_CONSUMED_TTL_SECONDS = 16 * 60; // 1 min beyond JWT exp

// Caps & limits (PRD §7.17)
export const DAILY_SNIPLET_CAP = 1000;
export const PER_IP_SNIPLET_DAILY = 50;
export const PER_EMAIL_AUTH_HOURLY = 3;
export const PER_EMAIL_AUTH_DAILY = 10;
export const PER_IP_AUTH_DAILY = 30;
export const AUTH_SEND_DAILY_CAP = 100; // F-32, aligned to Resend free tier
export const CSP_REPORT_PER_IP_PER_MIN = 100; // F-40
export const CSP_REPORT_BODY_MAX_BYTES = 8192; // F-40

// Reserved subdomains / paths (PRD §7.16)
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "api", "www", "admin", "docs", "status", "blog", "help", "support",
  "app", "auth", "login", "signup", "dashboard", "settings", "pricing",
  "about", "terms", "privacy", "security", "mail", "smtp", "ns1", "ns2",
  "cdn", "assets", "static", "media", "img", "dev", "staging", "test", "prod",
]);

export const APEX = "sniplet.page";
export const API_HOST = "api.sniplet.page";
