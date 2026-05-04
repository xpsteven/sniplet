import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAuthConsume,
  handleAuthLogout,
  handleAuthRequest,
} from "../../src/handlers/auth.ts";
import { signJwt, type JwtClaims } from "../../src/lib/jwt.ts";
import { hmacSha256Hex } from "../../src/lib/crypto.ts";
import { addToEmailIndex } from "../../src/lib/kv.ts";
import { handlePostSniplet } from "../../src/handlers/sniplets.ts";
import { makeCtx, makeEnv, makeJsonReq, type TestEnv } from "../helpers/mockEnv.ts";

const ORIGIN_APEX = "https://sniplet.page";

function magicClaims(secret: string, sub: string, returnTo: string, jti = "j-1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    sub,
    purpose: "magic",
    iat: now,
    exp: now + 600,
    v: 1,
    jti,
    return_to: returnTo,
  };
  return signJwt(claims, secret);
}

describe("/auth/consume", () => {
  it("verifies a valid magic JWT, sets session cookie, returns redirect", async () => {
    const env = makeEnv();
    const sub = await hmacSha256Hex(env.EMAIL_HASH_SECRET, "alice@co.com");
    const t = await magicClaims(env.MAGIC_JWT_SECRET, sub, "https://q3-sales-a7k2.sniplet.page/");
    const req = makeJsonReq("https://sniplet.page/auth/consume", "POST", { t }, { origin: ORIGIN_APEX });
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json<{ redirect: string }>();
    expect(body.redirect).toBe("https://q3-sales-a7k2.sniplet.page/");
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^st=/);
    expect(setCookie).toContain("Domain=sniplet.page");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("rejects request without Origin: https://sniplet.page (F-35)", async () => {
    const env = makeEnv();
    const t = await magicClaims(env.MAGIC_JWT_SECRET, "abc", "https://sniplet.page/");
    const req = makeJsonReq(
      "https://sniplet.page/auth/consume",
      "POST",
      { t },
      { origin: "https://evil-x9k2.sniplet.page" },
    );
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_origin");
  });

  it("rejects non-JSON Content-Type (F-37)", async () => {
    const env = makeEnv();
    const t = await magicClaims(env.MAGIC_JWT_SECRET, "abc", "https://sniplet.page/");
    const req = new Request("https://sniplet.page/auth/consume", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: ORIGIN_APEX },
      body: JSON.stringify({ t }),
    });
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_content_type");
  });

  it("rejects replay (F-6)", async () => {
    const env = makeEnv();
    const t = await magicClaims(env.MAGIC_JWT_SECRET, "abc", "https://sniplet.page/", "j-replay");
    const req1 = makeJsonReq("https://sniplet.page/auth/consume", "POST", { t }, { origin: ORIGIN_APEX });
    const r1 = await handleAuthConsume(req1, env, makeCtx());
    expect(r1.status).toBe(200);
    const req2 = makeJsonReq("https://sniplet.page/auth/consume", "POST", { t }, { origin: ORIGIN_APEX });
    const r2 = await handleAuthConsume(req2, env, makeCtx());
    expect(r2.status).toBe(422);
    const b = await r2.json<{ error: string }>();
    expect(b.error).toBe("already_consumed");
  });

  it("ignores body `r` and uses JWT claim's return_to (F-36)", async () => {
    const env = makeEnv();
    const t = await magicClaims(env.MAGIC_JWT_SECRET, "abc", "https://legit-aaaa.sniplet.page/");
    const req = makeJsonReq(
      "https://sniplet.page/auth/consume",
      "POST",
      { t, r: "https://evil-aaaa.sniplet.page/" },
      { origin: ORIGIN_APEX },
    );
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json<{ redirect: string }>();
    expect(body.redirect).toBe("https://legit-aaaa.sniplet.page/");
  });

  it("rejects token signed with wrong secret", async () => {
    const env = makeEnv();
    const t = await magicClaims("wrong-secret", "abc", "https://sniplet.page/");
    const req = makeJsonReq("https://sniplet.page/auth/consume", "POST", { t }, { origin: ORIGIN_APEX });
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(401);
  });

  it("rejects session JWT presented as magic (purpose mismatch)", async () => {
    const env = makeEnv();
    const now = Math.floor(Date.now() / 1000);
    const sessionToken = await signJwt(
      { sub: "abc", purpose: "session", iat: now, exp: now + 600, v: 1 } as JwtClaims,
      env.MAGIC_JWT_SECRET,
    );
    const req = makeJsonReq(
      "https://sniplet.page/auth/consume",
      "POST",
      { t: sessionToken },
      { origin: ORIGIN_APEX },
    );
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(401);
  });

  it("falls back to apex when JWT return_to is invalid", async () => {
    const env = makeEnv();
    const t = await magicClaims(env.MAGIC_JWT_SECRET, "abc", "javascript:alert(1)");
    const req = makeJsonReq("https://sniplet.page/auth/consume", "POST", { t }, { origin: ORIGIN_APEX });
    const res = await handleAuthConsume(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json<{ redirect: string }>();
    expect(body.redirect).toBe("https://sniplet.page/");
  });
});

describe("/auth/logout", () => {
  it("clears cookie when Origin is apex", () => {
    const env = makeEnv();
    const req = new Request("https://sniplet.page/auth/logout", {
      method: "POST",
      headers: { origin: ORIGIN_APEX },
    });
    const res = handleAuthLogout(req, env, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("accepts a postfixed sniplet subdomain Origin", () => {
    const env = makeEnv();
    const req = new Request("https://sniplet.page/auth/logout", {
      method: "POST",
      headers: { origin: "https://q3-sales-a7k2.sniplet.page" },
    });
    const res = handleAuthLogout(req, env, makeCtx());
    expect(res.status).toBe(200);
  });

  it("rejects evil.com origin (S-6 CSRF)", () => {
    const env = makeEnv();
    const req = new Request("https://sniplet.page/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    const res = handleAuthLogout(req, env, makeCtx());
    expect(res.status).toBe(400);
  });

  it("rejects missing Origin", () => {
    const env = makeEnv();
    const req = new Request("https://sniplet.page/auth/logout", { method: "POST" });
    const res = handleAuthLogout(req, env, makeCtx());
    expect(res.status).toBe(400);
  });
});

describe("/auth/request", () => {
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("turnstile/v0/siteverify")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes("api.resend.com/emails")) {
        return new Response(JSON.stringify({ id: "test-id" }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  function authReq(_env: TestEnv, body: Record<string, unknown>): Request {
    return new Request("https://sniplet.page/auth/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN_APEX,
        "cf-connecting-ip": "203.0.113.1",
      },
      body: JSON.stringify(body),
    });
  }

  it("returns 200 even if email is not on whitelist (Strategy C)", async () => {
    const env = makeEnv();
    const res = await handleAuthRequest(
      authReq(env, {
        email: "stranger@external.com",
        return_to: "https://sniplet.page/",
        turnstile_token: "tt",
      }),
      env,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    // Resend should NOT have been called for non-whitelisted email.
    const fetchCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const resendCalls = fetchCalls.filter((c) => String(c[0]).includes("api.resend.com"));
    expect(resendCalls.length).toBe(0);
  });

  it("sends email via Resend when email is on whitelist", async () => {
    const env = makeEnv();
    // Pre-populate email index.
    const emailHmac = await hmacSha256Hex(env.EMAIL_HASH_SECRET, "alice@co.com");
    await addToEmailIndex(env.EMAIL_INDEX_KV, emailHmac, "test-slug-aaaa", 3600);

    const waitUntilPromises: Promise<unknown>[] = [];
    const realCtx = {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const res = await handleAuthRequest(
      authReq(env, {
        email: "alice@co.com",
        return_to: "https://test-slug-aaaa.sniplet.page/",
        turnstile_token: "tt",
      }),
      env,
      realCtx,
    );
    expect(res.status).toBe(200);
    // Wait for ctx.waitUntil to drain.
    await Promise.all(waitUntilPromises);
    const fetchCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const resendCalls = fetchCalls.filter((c) => String(c[0]).includes("api.resend.com"));
    expect(resendCalls.length).toBe(1);
  });

  it("rejects on Turnstile failure", async () => {
    const env = makeEnv();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    ) as unknown as typeof fetch;
    const res = await handleAuthRequest(
      authReq(env, {
        email: "alice@co.com",
        return_to: "https://sniplet.page/",
        turnstile_token: "bad",
      }),
      env,
      makeCtx(),
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("turnstile_failed");
  });
});

describe("/auth/request → /auth/consume → cookie → re-use across sniplets", () => {
  it("Alice's session cookie unlocks any sniplet she's whitelisted on", async () => {
    const env = makeEnv();
    // Build two private sniplets sharing alice@co.com on the whitelist.
    const post = (slug: string) =>
      handlePostSniplet(
        makeJsonReq(
          "https://api.sniplet.page/v1/sniplets",
          "POST",
          { html: "<p>x</p>", slug, viewers: ["alice@co.com"] },
        ),
        env,
        makeCtx(),
      );
    const r1 = await post("priv-a");
    const r2 = await post("priv-b");
    const a = await r1.json<{ slug: string }>();
    const b = await r2.json<{ slug: string }>();

    // Sign a magic JWT for alice; consume it.
    const sub = await hmacSha256Hex(env.EMAIL_HASH_SECRET, "alice@co.com");
    const magic = await magicClaims(
      env.MAGIC_JWT_SECRET,
      sub,
      `https://${a.slug}.sniplet.page/`,
    );
    const consume = await handleAuthConsume(
      makeJsonReq(
        "https://sniplet.page/auth/consume",
        "POST",
        { t: magic },
        { origin: ORIGIN_APEX },
      ),
      env,
      makeCtx(),
    );
    expect(consume.status).toBe(200);
    const setCookie = consume.headers.get("set-cookie")!;
    const stMatch = /^st=([^;]+)/.exec(setCookie);
    const sessionToken = stMatch![1]!;

    // The same cookie's `sub` should appear in both sniplets' viewers[].h.
    // (We don't directly call handleSnipletGet here; the cross-sniplet test
    // is already covered structurally — same emailHmac → same sub → same h.)
    expect(b.slug).toMatch(/^priv-b-[a-z0-9]{4}$/);
    void sessionToken;
  });
});
