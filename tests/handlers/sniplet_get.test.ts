import { describe, expect, it } from "vitest";
import { handleSnipletGet } from "../../src/handlers/sniplet_get.ts";
import { handlePostSniplet } from "../../src/handlers/sniplets.ts";
import { handleAuthConsume } from "../../src/handlers/auth.ts";
import { signJwt, type JwtClaims } from "../../src/lib/jwt.ts";
import { hmacSha256Hex } from "../../src/lib/crypto.ts";
import { makeCtx, makeEnv, makeJsonReq } from "../helpers/mockEnv.ts";

async function createSniplet(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>) {
  const r = await handlePostSniplet(
    makeJsonReq("https://api.sniplet.page/v1/sniplets", "POST", body),
    env,
    makeCtx(),
  );
  return r.json<{ slug: string; access: string }>();
}

describe("GET / on {slug}.sniplet.page", () => {
  it("serves public sniplet HTML with strict CSP", async () => {
    const env = makeEnv();
    const created = await createSniplet(env, { html: "<p>hello</p>", slug: "pub" });
    const req = new Request(`https://${created.slug}.sniplet.page/`);
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("hello");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("https://cdnjs.cloudflare.com");
    expect(csp).toContain("connect-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("permissions-policy")).toContain("geolocation=()");
  });

  it("returns 404 for unknown slug + writes sniplet_404_miss event (F-42)", async () => {
    const env = makeEnv();
    const req = new Request("https://nope-aaaa.sniplet.page/");
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(404);
    expect(env.__mocks.ANALYTICS.byName("sniplet_404_miss").length).toBe(1);
  });

  it("returns 404 (NOT 410) for expired sniplet (F-9)", async () => {
    const env = makeEnv();
    const created = await createSniplet(env, { html: "<p>x</p>", slug: "old" });
    // Hack expiry: rewrite meta to past.
    const metaKey = `sniplets/${created.slug}/meta.json`;
    const metaObj = await env.__mocks.SNIPLETS._peekMeta<Record<string, unknown>>(metaKey);
    metaObj!.expires_at = "2020-01-01T00:00:00Z";
    await env.__mocks.SNIPLETS.put(metaKey, JSON.stringify(metaObj));
    const req = new Request(`https://${created.slug}.sniplet.page/`);
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(404);
  });

  it("private sniplet: shows challenge page when no cookie", async () => {
    const env = makeEnv();
    const created = await createSniplet(env, {
      html: "<p>secret</p>",
      slug: "priv",
      viewers: ["alice@co.com"],
    });
    const req = new Request(`https://${created.slug}.sniplet.page/`);
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("This sniplet is private");
    expect(text).not.toContain("secret");
  });

  it("private sniplet: serves HTML when cookie's sub matches viewers[].h", async () => {
    const env = makeEnv();
    const created = await createSniplet(env, {
      html: "<p>secret data</p>",
      slug: "priv2",
      viewers: ["alice@co.com"],
    });

    // Build a session cookie with alice's HMAC.
    const sub = await hmacSha256Hex(env.EMAIL_HASH_SECRET, "alice@co.com");
    const now = Math.floor(Date.now() / 1000);
    const session = await signJwt(
      { sub, purpose: "session", iat: now, exp: now + 3600, v: 1 } as JwtClaims,
      env.SESSION_JWT_SECRET,
    );
    const req = new Request(`https://${created.slug}.sniplet.page/`, {
      headers: { cookie: `st=${session}` },
    });
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("secret data");
  });

  it("private sniplet: rejects cookie whose sub is not in viewers", async () => {
    const env = makeEnv();
    const created = await createSniplet(env, {
      html: "<p>secret</p>",
      slug: "priv3",
      viewers: ["alice@co.com"],
    });
    const otherSub = await hmacSha256Hex(env.EMAIL_HASH_SECRET, "stranger@x.co");
    const now = Math.floor(Date.now() / 1000);
    const session = await signJwt(
      { sub: otherSub, purpose: "session", iat: now, exp: now + 3600, v: 1 } as JwtClaims,
      env.SESSION_JWT_SECRET,
    );
    const req = new Request(`https://${created.slug}.sniplet.page/`, {
      headers: { cookie: `st=${session}` },
    });
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const text = await res.text();
    // Challenge page, not HTML.
    expect(text).toContain("This sniplet is private");
  });

  it("end-to-end: consume → cookie → access", async () => {
    const env = makeEnv();
    const created = await createSniplet(env, {
      html: "<p>e2e content</p>",
      slug: "e2e",
      viewers: ["alice@co.com"],
    });
    // Mint magic for alice and consume it.
    const sub = await hmacSha256Hex(env.EMAIL_HASH_SECRET, "alice@co.com");
    const now = Math.floor(Date.now() / 1000);
    const magic = await signJwt(
      {
        sub,
        purpose: "magic",
        iat: now,
        exp: now + 600,
        v: 1,
        jti: "e2e-jti",
        return_to: `https://${created.slug}.sniplet.page/`,
      } as JwtClaims,
      env.MAGIC_JWT_SECRET,
    );
    const consume = await handleAuthConsume(
      makeJsonReq(
        "https://sniplet.page/auth/consume",
        "POST",
        { t: magic },
        { origin: "https://sniplet.page" },
      ),
      env,
      makeCtx(),
    );
    const cookieHeader = consume.headers.get("set-cookie")!;
    const sessionTok = /^st=([^;]+)/.exec(cookieHeader)![1]!;
    const req = new Request(`https://${created.slug}.sniplet.page/`, {
      headers: { cookie: `st=${sessionTok}` },
    });
    const res = await handleSnipletGet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("e2e content");
  });
});
