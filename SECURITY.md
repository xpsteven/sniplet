# Security Policy

Thanks for caring about the security of sniplet.page. This document describes how to report vulnerabilities and what is in scope.

## Reporting a vulnerability

**Email**: `security@sniplet.page`

For severe issues, include the word `URGENT` in the subject line. We aim to acknowledge all reports within **72 hours**.

Please include:
- A clear description of the issue
- Steps to reproduce (or a proof-of-concept if you have one)
- The impact you think it has
- Any mitigation ideas you'd like to suggest

**Please do not publicly disclose the issue** until we've had a chance to investigate and patch. We'll coordinate disclosure timing with you.

## Scope

### In scope
- `sniplet.page`, `api.sniplet.page`, and any `*.sniplet.page` subdomain used to serve sniplet content
- The sniplet backend: authentication flow, access control, rate limiting, data handling
- The sniplet skill distribution (SKILL.md on GitHub, frontmatter name `sniplet-page-share`) — if it leaks secrets or enables attacks
- Source code in the public repo (once published)
- **`owner_token` exposure through the Cloudflare edge log pipeline** — if CF Log Push or Workers Trace captures the `Authorization` header, this counts as SEV-1

### Out of scope
- User-provided HTML content inside a sniplet (by design, sniplets are arbitrary HTML; if a creator puts malicious content in their own sniplet, that's not a platform vulnerability — but **cross-sniplet exfiltration is in scope**, though we expect SOP to handle this under the subdomain-per-sniplet architecture)
- Third-party services we depend on (Cloudflare, Resend, Turnstile) — please report those to the respective vendors
- Denial of service via ordinary traffic (CF edge handles this)
- Social engineering attacks against sniplet.page operators
- Physical security
- Attacks requiring a compromised device of the victim
- CAPTCHA bypass of Turnstile (this is Cloudflare's concern)

## What we consider a vulnerability

Examples of things we take seriously:
- **Cross-sniplet data leakage** — any path by which sniplet A's content or cookies can be read by sniplet B or a third party, given the subdomain-per-sniplet isolation model
- **Authentication bypass** — accessing a private sniplet without being on the viewer list
- **Email whitelist enumeration** — determining whether a given email is on any sniplet's whitelist (via timing, error codes, or any other side channel)
- **IP or email de-anonymization** — recovering plaintext IP or email from our stored hashes
- **Account takeover via magic link** — stealing or replaying another viewer's magic link
- **Magic link consumption by email security scanners** — if the two-step `/auth/verify` → `/auth/consume` flow has any path that lets a scanner consume a token before the real viewer
- **Owner token compromise** — gaining `owner_token` access through non-creator means, including exposure via Cloudflare edge log pipeline
- **Open redirect** — turning `/auth/verify` or `/auth/consume` into a redirect to arbitrary domains
- **XSS in platform-generated pages** — challenge page, auth verify/consume pages, root page
- **CSP bypass** — finding a way for served sniplet HTML to `fetch()` external origins, submit to external form actions, or load scripts from domains outside the allowlist
- **Cryptographic weaknesses** — weak randomness, predictable tokens, non-constant-time comparisons

## Disclosure timeline expectations

- **72 hours**: Acknowledgement of your report
- **14 days**: Initial assessment and severity classification
- **90 days**: Default maximum time to fix (we'll communicate earlier if we can fix faster, or request extension if we can't)
- **Public disclosure**: Coordinated with reporter after fix ships; we'll credit you in a CHANGELOG entry if you'd like

## Safe harbor

We will not pursue legal action against security researchers who:
- Follow this policy in good faith
- Do not access or modify data beyond what's necessary to demonstrate the vulnerability
- Do not publicly disclose before we've had a chance to fix
- Do not disrupt service for other users

---

*Last updated: 2026-04-18 (v0.8.10)*
