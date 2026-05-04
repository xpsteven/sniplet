// PRD §7.19 — security headers + CSP variants.

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "clipboard-read=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-create=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "web-share=()",
  "xr-spatial-tracking=()",
  // clipboard-write intentionally not disabled — preserves "copy URL" UX.
].join(", ");

// PRD §7.19 unified strict CSP for sniplet HTML (creator content).
const CSP_SNIPLET = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com",
  "style-src 'unsafe-inline' https://cdnjs.cloudflare.com",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "report-uri https://api.sniplet.page/v1/csp-report",
  "report-to csp",
].join("; ");

// Platform pages with no external deps (verify page, security, 404, SKILL.md).
const CSP_PLATFORM_STRICT = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'self' https://sniplet.page https://api.sniplet.page",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

// Challenge page — needs Turnstile (script + iframe).
const CSP_CHALLENGE = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src https://sniplet.page https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "form-action https://sniplet.page",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

export type CspKind = "sniplet" | "platform" | "challenge" | "none";

interface SecurityHeaderOpts {
  csp?: CspKind;
  contentType?: string;
  cacheControl?: string;
  extra?: Record<string, string>;
}

export function securityHeaders(opts: SecurityHeaderOpts = {}): Headers {
  const h = new Headers();
  h.set("X-Frame-Options", "DENY");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  h.set("Permissions-Policy", PERMISSIONS_POLICY);
  h.set(
    "Reporting-Endpoints",
    `csp="https://api.sniplet.page/v1/csp-report"`,
  );

  if (opts.csp && opts.csp !== "none") {
    const csp =
      opts.csp === "sniplet" ? CSP_SNIPLET
        : opts.csp === "challenge" ? CSP_CHALLENGE
          : CSP_PLATFORM_STRICT;
    h.set("Content-Security-Policy", csp);
  }
  if (opts.contentType) h.set("Content-Type", opts.contentType);
  // Always include `no-transform` to block Cloudflare auto-injection
  // (Bot Fight Mode challenge JS, Email Obfuscation, Server-Side Excludes,
  // Rocket Loader, Auto-Minify) into responses we serve to clients.
  if (opts.cacheControl) {
    const cc = opts.cacheControl.includes("no-transform")
      ? opts.cacheControl
      : `${opts.cacheControl}, no-transform`;
    h.set("Cache-Control", cc);
  } else {
    h.set("Cache-Control", "no-transform");
  }
  if (opts.extra) for (const [k, v] of Object.entries(opts.extra)) h.set(k, v);
  return h;
}
