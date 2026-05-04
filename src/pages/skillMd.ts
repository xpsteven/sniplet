// SKILL.md served at apex `/` and `/SKILL.md` — PRD §10.2.
// `import skill from "../../SKILL.md"` is wired through wrangler.toml [[rules]]
// type="Text" so the contents are inlined at bundle time.

// @ts-expect-error — wrangler.toml [[rules]] type="Text" makes this a string import.
import SKILL_MD from "../../SKILL.md";

import { securityHeaders } from "../lib/headers.ts";

const skillMd = SKILL_MD as string;

export function skillMdResponse(): Response {
  const h = securityHeaders({
    csp: "none", // text/plain; CSP irrelevant
    contentType: "text/plain; charset=utf-8",
    cacheControl: "public, max-age=3600",
    extra: {
      "Content-Disposition": 'inline; filename="SKILL.md"',
    },
  });
  return new Response(skillMd, { status: 200, headers: h });
}
