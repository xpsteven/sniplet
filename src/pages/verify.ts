// PRD §10.4 — verify confirmation page. Displays only; never consumes the token.

import { securityHeaders } from "../lib/headers.ts";

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Continue · sniplet.page</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f7f7f9; min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 1rem; }
  .card { background: white; max-width: 420px; padding: 2rem; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
  .brand { font-size: .85rem; color: #888; margin-bottom: 1.5rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .5rem; }
  p { color: #555; margin: .5rem 0; }
  button { width: 100%; padding: .75rem; border: none; border-radius: 8px; background: #111; color: white; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
  button:disabled { opacity: .5; cursor: progress; }
  .hint { font-size: .8rem; color: #888; margin-top: 1rem; }
  .err { color: #c33; font-size: .9rem; margin-top: 1rem; min-height: 1.4em; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1c; color: #eee; }
    .card { background: #2a2a2c; }
    p { color: #bbb; }
    button { background: #eee; color: #111; }
    .hint { color: #999; }
  }
</style>
</head><body>
<div class="card">
  <div class="brand">sniplet.page</div>
  <h1>Continue to view your sniplet</h1>
  <p>You're about to sign in to sniplet.page.</p>
  <button id="continue">Continue</button>
  <p class="hint">This link expires in 15 minutes and can only be used once.</p>
  <p class="err" id="err"></p>
</div>
<script>
(function(){
  // Read token from URL query; never expose to DOM.
  var params = new URLSearchParams(location.search);
  var t = params.get("t");
  var btn = document.getElementById("continue");
  var err = document.getElementById("err");

  if (!t) {
    btn.disabled = true;
    err.textContent = "Missing token. Please open this link directly from the email.";
    return;
  }

  btn.addEventListener("click", function(){
    btn.disabled = true;
    err.textContent = "";
    fetch("/auth/consume", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: t }),
    }).then(function(r){
      return r.json().then(function(b){ return { status: r.status, body: b }; });
    }).then(function(res){
      if (res.status === 200 && res.body.redirect) {
        window.location = res.body.redirect;
        return;
      }
      var msgs = {
        invalid_token: "This link is no longer valid. Please request a new magic link.",
        token_expired: "This link expired. Please request a new magic link.",
        already_consumed: "This link was already used. Please request a new magic link.",
        invalid_origin: "Browser session issue. Please open this link directly from the email.",
        invalid_content_type: "Browser session issue. Please open this link directly from the email.",
      };
      err.textContent = msgs[res.body.error] || "Something went wrong. Please try again.";
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

export function verifyPageResponse(): Response {
  return new Response(HTML, {
    status: 200,
    headers: securityHeaders({
      csp: "platform",
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store",
    }),
  });
}
