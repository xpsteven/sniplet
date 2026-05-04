// PRD §10.3 — challenge page for private sniplets without a valid session cookie.
// Cross-origin POSTs to https://sniplet.page/auth/request via fetch.

import { securityHeaders } from "../lib/headers.ts";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ChallengeOpts {
  ttlDaysRemaining: number;
  returnTo: string;
  turnstileSiteKey: string;
}

export function challengePageResponse(opts: ChallengeOpts): Response {
  const html = render(opts);
  return new Response(html, {
    status: 200,
    headers: securityHeaders({
      csp: "challenge",
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store",
    }),
  });
}

function render(opts: ChallengeOpts): string {
  const days = Math.max(0, Math.floor(opts.ttlDaysRemaining));
  const returnTo = escapeHtml(opts.returnTo);
  const siteKey = escapeHtml(opts.turnstileSiteKey);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private sniplet · sniplet.page</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f7f7f9; min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 1rem; }
  .card { background: white; max-width: 420px; padding: 2rem; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
  .brand { font-size: .85rem; color: #888; margin-bottom: 1.5rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .5rem; }
  p { color: #555; margin: .5rem 0; }
  label { display: block; font-size: .85rem; color: #555; margin-top: 1rem; margin-bottom: .25rem; }
  input { width: 100%; padding: .65rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
  button { width: 100%; padding: .75rem; border: none; border-radius: 8px; background: #111; color: white; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
  button:disabled { opacity: .5; cursor: progress; }
  .hint { font-size: .8rem; color: #888; margin-top: 1rem; }
  .err { color: #c33; font-size: .9rem; margin-top: 1rem; min-height: 1.4em; }
  .ok { color: #2a8; font-size: .9rem; margin-top: 1rem; }
  .footer { font-size: .75rem; color: #999; margin-top: 1.5rem; }
  #turnstile { margin-top: 1rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1c; color: #eee; }
    .card { background: #2a2a2c; }
    p { color: #bbb; }
    input { background: #1a1a1c; color: #eee; border-color: #444; }
    button { background: #eee; color: #111; }
    .hint, .footer { color: #999; }
  }
</style>
</head><body>
<div class="card">
  <div class="brand">sniplet.page</div>
  <h1>This sniplet is private</h1>
  <p>Enter your email to request access.</p>
  <form id="form" autocomplete="email">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autocomplete="email">
    <div id="turnstile"></div>
    <button id="submit" type="submit">Send magic link</button>
  </form>
  <p class="hint">A magic link will be sent if you're on the viewer list. Click the link, then Continue to view.</p>
  <p class="err" id="err"></p>
  <p class="ok" id="ok"></p>
  <p class="footer">This sniplet expires in ${days} day${days === 1 ? "" : "s"}.</p>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
(function(){
  var form = document.getElementById("form");
  var emailEl = document.getElementById("email");
  var btn = document.getElementById("submit");
  var err = document.getElementById("err");
  var ok = document.getElementById("ok");
  var tsContainer = document.getElementById("turnstile");

  // Render Turnstile when its script loads.
  window.onloadTurnstileCallback = function(){
    window.turnstile.render(tsContainer, {
      sitekey: ${JSON.stringify(siteKey)},
      size: "flexible"
    });
  };
  // Older Turnstile loader pattern: explicit onload.
  var s = document.querySelector('script[src*="turnstile"]');
  if (s) s.onload = window.onloadTurnstileCallback;

  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    err.textContent = "";
    ok.textContent = "";
    btn.disabled = true;

    var email = emailEl.value.trim();
    var token = (window.turnstile && window.turnstile.getResponse(tsContainer)) || "";

    if (!token) {
      err.textContent = "Please complete the verification and try again.";
      btn.disabled = false;
      return;
    }

    fetch("https://sniplet.page/auth/request", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email,
        return_to: ${JSON.stringify(returnTo)},
        turnstile_token: token,
      }),
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){
        return { status: r.status, body: b };
      });
    }).then(function(res){
      if (res.status === 200) {
        ok.textContent = "If this email is authorized, a magic link has been sent. Check your inbox.";
        return;
      }
      var msgs = {
        turnstile_failed: "Please complete the verification and try again.",
        rate_limited: "Too many attempts. Please try again later.",
        service_unavailable: "Service is temporarily busy. Please try again in a few minutes.",
        invalid_format: "Please enter a valid email address.",
      };
      err.textContent = msgs[res.body && res.body.error] || "Something went wrong. Please try again.";
      btn.disabled = false;
    }).catch(function(){
      err.textContent = "Network error. Please try again.";
      btn.disabled = false;
    });
  });
})();
</script>
</body></html>
`;
}
