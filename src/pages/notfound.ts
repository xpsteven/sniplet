import { securityHeaders } from "../lib/headers.ts";

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found · sniplet.page</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 420px; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.55; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { color: #555; margin: .25rem 0; }
  a { color: inherit; }
  .brand { font-size: .85rem; color: #888; margin-bottom: 2rem; }
</style>
</head><body>
<div class="brand">sniplet.page</div>
<h1>Not found</h1>
<p>This sniplet doesn't exist, or it has expired.</p>
<p><a href="https://sniplet.page/">sniplet.page</a></p>
</body></html>
`;

export function notFoundPage(): Response {
  return new Response(HTML, {
    status: 404,
    headers: securityHeaders({
      csp: "platform",
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store",
    }),
  });
}
