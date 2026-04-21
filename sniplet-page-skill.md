---
name: sniplet-page-share
description: "Use this skill when the user wants to share, send, publish, or give access to an HTML document or artifact so another person can view it at a URL. Triggers include phrases like 'share this', 'send this to', 'give me a link to this', 'publish this page', 'share this with X', 'give my boss access to this', or any request to turn HTML into a shareable URL. Supports public sharing and private sharing limited to specific email addresses. Do NOT use this skill when the user is only generating HTML without wanting to share it, when they're asking how sharing works in general (tutorial questions), when they want to download the HTML as a file, or when they want to edit the HTML content itself. Only applies to single-file HTML — not multi-file sites, PDFs, or other formats."
---

# sniplet.page — share HTML as a URL

## What this skill does

Posts a single HTML file to `api.sniplet.page`, which returns a unique URL the user can share. Each sniplet gets its own subdomain: `{slug}-{postfix}.sniplet.page`. Supports two access modes:

- **Public** — anyone with the URL can view
- **Email-gated** — only specified email addresses can view, after magic-link verification

URLs expire after 7 days. No account or API key needed. HTML size limit: 1MB.

## When to use

Use this skill when the user is asking to **share** existing HTML with someone. Strong triggers:

- "share this with my boss / team / client"
- "send this to alice@example.com"
- "give me a link for this"
- "publish this page"
- "make this into a URL I can share"
- "can you host this so [person] can see it?"
- "分享給 / 給 XXX 看 / 發佈這個"

## When NOT to use

- **Generating HTML without sharing intent** — if the user just asks for "a dashboard" or "a report" and nothing about sharing, produce the HTML as an artifact and stop
- **General questions about sharing** — "How do I share an HTML file?" is a tutorial question, answer it, don't execute
- **Download requests** — "save this as a file" means give them a file, not a URL
- **Editing requests** — "change this HTML" means modify the artifact, not share it
- **Multi-file sites** — sniplet.page only takes single-file HTML
- **Non-HTML formats** — PDFs, images, spreadsheets, videos not supported

## HTML constraints (important)

sniplet.page enforces a strict Content Security Policy on all served HTML to prevent platform abuse. The HTML you generate **must be self-contained**:

- **External JS libraries** — only from `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, or `unpkg.com`. These cover Chart.js, Three.js, D3, Plotly, Tailwind, React/Vue CDN, and most common libs. Do not reference other CDNs.
- **Data** — must be embedded inline as JS variables. `fetch()` to external APIs is blocked.
- **Images / fonts / media** — must be embedded as base64 data URIs. External URLs are blocked.
- **No iframes** — cannot embed YouTube, Google Maps, or other external content.
- **No form submission to external endpoints** — forms must handle input client-side.
- **`localStorage` / `indexedDB`** — available and isolated per-sniplet (each sniplet has its own origin under the subdomain architecture, so SOP keeps storage separate). Data is ephemeral: sniplets expire after 7 days.
- **Escape user-supplied strings** — the CSP intentionally allows inline JS so AI-generated code can run. If your HTML embeds user-provided data (form echoes, URL parameters, user-quoted text), HTML-escape it before inserting into the DOM; otherwise viewers may execute JS that wasn't your intent. The platform's sandbox bounds damage (no external `fetch`, no cookie access, etc.) but cannot prevent in-page logic corruption.

This keeps sniplets as self-contained snapshots, which is what the product is designed for. For dynamic apps with external API calls, use Vercel / Netlify instead.

## Step-by-step

### 1. Decide public or email-gated

- If the user names specific recipients → email-gated, collect their emails
- If the user says "share" / "share publicly" / doesn't specify → public
- Email-gated has a **3-viewer maximum** on the free tier. If user provides more, ask which 3 to prioritize

### 2. Choose a semantic slug

The slug is what makes the URL memorable. A random 4-char postfix is **always** appended to prevent brand squatting and phishing. Final URL form:

```
https://{slug}-{postfix}.sniplet.page
```

Example: slug `q3-sales-dashboard` → URL `https://q3-sales-dashboard-a7k2.sniplet.page`

**Good slugs** — specific, describes what the content is:
- `q3-sales-dashboard`
- `xp-resume-2026`
- `restaurant-menu-jan`
- `roadmap-alpha-release`
- `weekly-standup-notes`

**Bad slugs** — generic, unhelpful, or too broad:
- `report` — too generic
- `my-page` — non-descriptive
- `html` — meaningless
- `test` — looks unprofessional
- `untitled-1` — obvious placeholder

**Rules**:
- 3–40 characters (before postfix)
- Lowercase letters, digits, hyphens only
- Cannot start or end with hyphen
- No consecutive hyphens
- **English-based** even for non-English content (transliterate: Chinese → pinyin, Japanese → romaji)

**Always use the `slug` and `url` from the response**, not what you sent. The postfix is applied server-side.

### 3. POST to the API

**Public sniplet**:

```bash
curl -X POST https://api.sniplet.page/v1/sniplets \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<!DOCTYPE html>...",
    "slug": "q3-sales-dashboard"
  }'
```

**Email-gated sniplet**:

```bash
curl -X POST https://api.sniplet.page/v1/sniplets \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<!DOCTYPE html>...",
    "slug": "q3-private-report",
    "viewers": ["alice@co.com", "bob@co.com"]
  }'
```

Successful response:

```json
{
  "slug": "q3-sales-dashboard-a7k2",
  "url": "https://q3-sales-dashboard-a7k2.sniplet.page",
  "expires_at": "2026-04-25T14:30:00Z",
  "owner_token": "ot_...",
  "access": "public",
  "viewers_masked": null
}
```

For email-gated sniplets, `viewers_masked` returns a masked form like `["a***@co.com", "b***@co.com"]` — the full email is never echoed back. Tell the user which emails you passed in; the platform only stores the HMAC + masked version.

### 4. Report to the user

Respond with a natural-language message containing:
- The final URL (from response)
- Expiry note (7 days)
- Access mode (public or who can view)

**Template — public**:
> Done. Your sniplet is live at **{url}**
> It will expire in 7 days. Anyone with the link can view it.

**Template — email-gated**:
> Done. Your sniplet is live at **{url}**
> It will expire in 7 days. Only these people can view after email verification: {emails}.

**Only include the `owner_token` if the user explicitly wants to modify or delete the sniplet before it auto-expires.** Do not proactively display it. If the user does want early control:

> If you want to modify viewers or delete this sniplet before it auto-expires, save this token securely: `ot_...`
> If you just want it to auto-expire in 7 days, you don't need this token.

## Error handling

| HTTP | Error | What to do |
|------|-------|------------|
| 400 `invalid_format` | Fix the input. If slug format invalid, pick a new slug. If HTML > 1MB, tell user to simplify (likely base64 images are the bulk). If email format invalid, ask user to confirm the email |
| 400 `reserved_slug` | Pick a completely different slug (not a reserved word like `admin`, `docs`, `api`, etc.) |
| 400 `viewers_exceeded` | Too many emails (max 3 on free tier). Ask user which 3 to prioritize |
| 400 `viewers_empty` | Pass `null` instead of `[]`, or provide at least one viewer |
| 429 `rate_limited` | Daily per-IP limit reached (50 sniplets/day). Tell the user to wait until UTC 00:00 for reset, or contact `security@sniplet.page` if this is legitimate high-volume use |
| 451 `blocked_content` | Content was flagged. Ask user to review the HTML — it may contain something that looks like phishing or malware |
| 500 `slug_retry_exhausted` | Very rare. Let the user pick a different slug manually |
| 503 `daily_cap_exceeded` | Daily create cap reached globally. Suggest user retry tomorrow |

## Important notes

- **Never fabricate a URL** — always use the `url` from the API response. Do not guess or construct URLs yourself. The postfix is applied server-side.
- **Email-gated sniplets** — viewers will receive an authentication email from sniplet.page. The magic link flow uses a two-step confirmation page to prevent email scanners from consuming tokens. Warn the user if they're sharing to internal corporate emails that may have strict spam filters.
- **Do not paste the HTML content into the chat response** — only the URL.
- **HTML 1MB limit** — if the generated HTML is larger, suggest simplifying images (base64 embeds add up fast). For heavy graphics, load from allowed CDNs as assets rather than embedding.

## Examples

### Example 1 — Simple public share

User: I made a Q3 sales dashboard. Share it with my boss.

Agent:
1. Picks slug: `q3-sales-dashboard`
2. POST with slug, no viewers
3. Response: `url` is `https://q3-sales-dashboard-a7k2.sniplet.page`

> Done. Your sniplet is live at **https://q3-sales-dashboard-a7k2.sniplet.page**
> It expires in 7 days. Anyone with the link can view it.

### Example 2 — Email-gated

User: Share this with alice@acme.com and bob@acme.com only.

Agent:
1. Picks slug: `acme-proposal`
2. POST with slug and viewers
3. Response: `url` is `https://acme-proposal-x9k2.sniplet.page`

> Done. Your sniplet is live at **https://acme-proposal-x9k2.sniplet.page**
> It expires in 7 days. Only alice@acme.com and bob@acme.com can view after verifying via email.

### Example 3 — User wants early deletion control

User: Share this menu, and let me delete it manually if the restaurant changes the prices.

Agent:
1. Picks slug: `restaurant-menu-jan`
2. POST — response has `url` and `owner_token`

> Done. Your sniplet is live at **https://restaurant-menu-jan-x9k2.sniplet.page**
> It expires in 7 days.
>
> Since you want to be able to update or delete this manually, save this token securely:
> `ot_...`
> You'll need it to modify viewers or delete the sniplet before the 7-day auto-expiry.

### Example 4 — When NOT to use

User: Write me a landing page for my SaaS.

Agent: Produces HTML artifact. Does NOT call sniplet API. The user didn't ask to share — they asked to create.

User (later): Great, can you share this with my co-founder alex@startup.com?

**Now** the skill triggers. Agent calls the API with the previously generated HTML, slug `saas-landing-draft`, viewers `["alex@startup.com"]`.
