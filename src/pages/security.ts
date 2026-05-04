// PRD §10.7 — public security policy at sniplet.page/security.

import { securityHeaders } from "../lib/headers.ts";

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security Policy · sniplet.page</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 720px; margin: 3rem auto; padding: 0 1.5rem; line-height: 1.6; }
  h1 { font-size: 1.75rem; margin-top: 0; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  code { background: rgba(127,127,127,.15); padding: 0.05em 0.3em; border-radius: 3px; }
  ul { padding-left: 1.25rem; }
  .brand { font-size: .85rem; color: #888; margin-bottom: 2rem; }
  .advisories { padding: 1rem 1.25rem; background: rgba(127,127,127,.07); border-left: 3px solid #aaa; border-radius: 4px; margin: 1rem 0 2rem; }
  .advisories:empty::before { content: "No active advisories."; color: #888; font-style: italic; }
</style>
</head><body>
<div class="brand">sniplet.page</div>
<h1>Security Policy</h1>
<p>sniplet.page takes security seriously. This page describes how to report vulnerabilities and what we consider in scope.</p>

<h2 id="advisories">Advisories</h2>
<div class="advisories"></div>

<h2>Reporting a vulnerability</h2>
<ul>
  <li>Email: <a href="mailto:security@sniplet.page">security@sniplet.page</a></li>
  <li>Add <code>URGENT</code> to the subject for critical issues.</li>
  <li>We aim to acknowledge within 72 hours.</li>
  <li>Please include: description, reproduction steps / PoC, expected impact, suggested mitigation.</li>
  <li>Please don't publicly disclose until we've fixed the issue; we'll coordinate disclosure.</li>
</ul>

<h2>Scope</h2>
<p><strong>In scope:</strong> sniplet.page, api.sniplet.page, all *.sniplet.page subdomains, the sniplet backend (auth, access control, rate limiting, data handling), the sniplet skill (SKILL.md, frontmatter <code>sniplet-page-share</code>) — particularly leaks of secrets or attack-enabling behaviour, including <code>owner_token</code> exposure via CF edge log pipeline (SEV-1).</p>
<p><strong>Out of scope:</strong> user-uploaded HTML content (any HTML is allowed by design — but cross-sniplet exfiltration is in scope), third-party services (Cloudflare, Resend, Turnstile), ordinary traffic DoS (handled at edge), social engineering, physical security, attacks against already-compromised victim devices, Turnstile CAPTCHA bypass.</p>

<h2>What we consider a vulnerability</h2>
<ul>
  <li>Cross-sniplet data leakage</li>
  <li>Authentication bypass</li>
  <li>Email whitelist enumeration</li>
  <li>IP / email de-anonymization</li>
  <li>Account takeover via magic link</li>
  <li>Magic link consumption by email scanners</li>
  <li>Owner token compromise</li>
  <li>Open redirect</li>
  <li>XSS in platform-generated pages</li>
  <li>CSP bypass</li>
  <li>Cryptographic weaknesses</li>
</ul>

<h2>Disclosure timeline</h2>
<ul>
  <li>72 hours: acknowledgement</li>
  <li>14 days: initial assessment + severity classification</li>
  <li>90 days: default maximum time to fix</li>
  <li>Public disclosure: coordinated; with researcher consent we credit on release notes</li>
</ul>

<h2>Safe harbor</h2>
<p>We won't pursue legal action against good-faith research that follows this policy. Please: do not access or modify data beyond what's necessary to demonstrate the issue, do not disclose before remediation, and do not interfere with other users.</p>

<h2>Other links</h2>
<ul>
  <li><a href="/.well-known/security.txt">/.well-known/security.txt</a> (RFC 9116)</li>
  <li><a href="/">SKILL.md (agent contract)</a></li>
</ul>
</body></html>
`;

export function securityPageResponse(): Response {
  return new Response(HTML, {
    status: 200,
    headers: securityHeaders({
      csp: "platform",
      contentType: "text/html; charset=utf-8",
      cacheControl: "public, max-age=3600",
    }),
  });
}

const SECURITY_TXT = `Contact: mailto:security@sniplet.page
Expires: 2027-04-21T00:00:00Z
Preferred-Languages: en, zh-TW
Canonical: https://sniplet.page/.well-known/security.txt
Policy: https://sniplet.page/security
`;

export function securityTxtResponse(): Response {
  return new Response(SECURITY_TXT, {
    status: 200,
    headers: securityHeaders({
      csp: "none",
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=86400",
    }),
  });
}
