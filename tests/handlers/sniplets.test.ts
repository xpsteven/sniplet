import { describe, expect, it } from "vitest";
import {
  handleDeleteSniplet,
  handlePatchViewers,
  handlePostSniplet,
} from "../../src/handlers/sniplets.ts";
import { makeCtx, makeEnv, makeJsonReq } from "../helpers/mockEnv.ts";
import type { SnipletMeta } from "../../src/types.ts";

describe("POST /v1/sniplets", () => {
  it("creates a public sniplet with postfixed slug", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<!doctype html><h1>hi</h1>", slug: "q3-sales" },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json<{
      slug: string;
      url: string;
      access: string;
      owner_token: string;
      viewers_masked: string[] | null;
    }>();
    expect(body.slug).toMatch(/^q3-sales-[a-z0-9]{4}$/);
    expect(body.url).toBe(`https://${body.slug}.sniplet.page`);
    expect(body.access).toBe("public");
    expect(body.viewers_masked).toBe(null);
    expect(body.owner_token).toMatch(/^ot_/);
    expect(env.__mocks.SNIPLETS._has(`sniplets/${body.slug}/index.html`)).toBe(true);
    expect(env.__mocks.SNIPLETS._has(`sniplets/${body.slug}/meta.json`)).toBe(true);
    expect(env.__mocks.ANALYTICS.byName("sniplet_created")).toHaveLength(1);
  });

  it("creates an email-gated sniplet and writes to EMAIL_INDEX_KV", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      {
        html: "<p>private</p>",
        slug: "private",
        viewers: ["alice@co.com", "Bob@CO.com"],
      },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json<{ slug: string; viewers_masked: string[]; access: string }>();
    expect(body.access).toBe("email-gated");
    expect(body.viewers_masked).toEqual(expect.arrayContaining(["a***@co.com", "b***@co.com"]));
    // Two viewer index entries.
    const idx = env.__mocks.EMAIL_INDEX_KV._all();
    expect(idx.size).toBe(2);
    for (const v of idx.values()) {
      const parsed = JSON.parse(v) as { slugs: string[] };
      expect(parsed.slugs).toEqual([body.slug]);
    }
  });

  it("rejects invalid slug format", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>", slug: "Invalid--Slug" },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_format");
  });

  it("rejects reserved slug", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>", slug: "admin" },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("reserved_slug");
  });

  it("rejects empty viewers array", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>", slug: "abc-def", viewers: [] },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("viewers_empty");
  });

  it("rejects > 3 viewers", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      {
        html: "<p>x</p>",
        slug: "abc-def",
        viewers: ["a@b.co", "b@c.co", "c@d.co", "d@e.co"],
      },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("viewers_exceeded");
  });

  it("rejects non-JSON Content-Type (F-37)", async () => {
    const env = makeEnv();
    const req = new Request("https://api.sniplet.page/v1/sniplets", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ html: "x", slug: "abc-def" }),
    });
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_content_type");
  });

  it("stores viewers as HMAC + masked, never plaintext (F-11)", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>", slug: "tester", viewers: ["alice@co.com"] },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    const body = await res.json<{ slug: string }>();
    const meta = await env.__mocks.SNIPLETS._peekMeta<SnipletMeta>(`sniplets/${body.slug}/meta.json`);
    expect(meta).not.toBeNull();
    expect(meta!.viewers).toHaveLength(1);
    expect(meta!.viewers![0]!.h).toMatch(/^[0-9a-f]{64}$/);
    expect(meta!.viewers![0]!.m).toBe("a***@co.com");
    // Stringified meta MUST NOT contain the plaintext email.
    const raw = JSON.stringify(meta);
    expect(raw).not.toContain("alice@co.com");
  });

  it("auto-generates slug if not provided", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>" },
    );
    const res = await handlePostSniplet(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json<{ slug: string }>();
    // 8-char base + "-" + 4-char postfix = 13 chars total.
    expect(body.slug).toMatch(/^[a-z0-9]{8}-[a-z0-9]{4}$/);
  });
});

describe("PATCH /v1/sniplets/:slug/viewers", () => {
  async function setupSniplet() {
    const env = makeEnv();
    const post = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>", slug: "patch-test", viewers: ["alice@co.com"] },
    );
    const postRes = await handlePostSniplet(post, env, makeCtx());
    const created = await postRes.json<{ slug: string; owner_token: string }>();
    return { env, slug: created.slug, ownerToken: created.owner_token };
  }

  it("adds + removes viewers atomically", async () => {
    const { env, slug, ownerToken } = await setupSniplet();
    const req = makeJsonReq(
      `https://api.sniplet.page/v1/sniplets/${slug}/viewers`,
      "PATCH",
      { add: ["bob@co.com"], remove: ["alice@co.com"] },
      { authorization: `Bearer ${ownerToken}` },
    );
    const res = await handlePatchViewers(req, env, makeCtx(), slug);
    expect(res.status).toBe(200);
    const body = await res.json<{ viewers_masked: string[]; access: string }>();
    expect(body.viewers_masked).toEqual(["b***@co.com"]);
    expect(body.access).toBe("email-gated");
    expect(env.__mocks.ANALYTICS.byName("sniplet_mutated").length).toBe(1);
  });

  it("removing all viewers reverts to public", async () => {
    const { env, slug, ownerToken } = await setupSniplet();
    const req = makeJsonReq(
      `https://api.sniplet.page/v1/sniplets/${slug}/viewers`,
      "PATCH",
      { remove: ["alice@co.com"] },
      { authorization: `Bearer ${ownerToken}` },
    );
    const res = await handlePatchViewers(req, env, makeCtx(), slug);
    expect(res.status).toBe(200);
    const body = await res.json<{ viewers_masked: string[] | null; access: string }>();
    expect(body.viewers_masked).toBe(null);
    expect(body.access).toBe("public");
  });

  it("returns 401 for nonexistent slug (F-33 unification)", async () => {
    const env = makeEnv();
    const req = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets/does-not-exist/viewers",
      "PATCH",
      { add: ["a@b.co"] },
      { authorization: "Bearer ot_anything" },
    );
    const res = await handlePatchViewers(req, env, makeCtx(), "does-not-exist");
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_token");
  });

  it("returns 401 for wrong token (same response as nonexistent slug)", async () => {
    const { env, slug } = await setupSniplet();
    const req = makeJsonReq(
      `https://api.sniplet.page/v1/sniplets/${slug}/viewers`,
      "PATCH",
      { add: ["b@c.co"] },
      { authorization: "Bearer ot_wrong" },
    );
    const res = await handlePatchViewers(req, env, makeCtx(), slug);
    expect(res.status).toBe(401);
  });

  it("rejects empty add+remove", async () => {
    const { env, slug, ownerToken } = await setupSniplet();
    const req = makeJsonReq(
      `https://api.sniplet.page/v1/sniplets/${slug}/viewers`,
      "PATCH",
      {},
      { authorization: `Bearer ${ownerToken}` },
    );
    const res = await handlePatchViewers(req, env, makeCtx(), slug);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("empty_request");
  });
});

describe("DELETE /v1/sniplets/:slug", () => {
  it("removes the sniplet on valid token", async () => {
    const env = makeEnv();
    const post = makeJsonReq(
      "https://api.sniplet.page/v1/sniplets",
      "POST",
      { html: "<p>x</p>", slug: "del-me" },
    );
    const postRes = await handlePostSniplet(post, env, makeCtx());
    const { slug, owner_token } = await postRes.json<{ slug: string; owner_token: string }>();
    expect(env.__mocks.SNIPLETS._size()).toBe(2);

    const del = new Request(`https://api.sniplet.page/v1/sniplets/${slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${owner_token}` },
    });
    const res = await handleDeleteSniplet(del, env, makeCtx(), slug);
    expect(res.status).toBe(204);
    expect(env.__mocks.SNIPLETS._size()).toBe(0);
    expect(env.__mocks.ANALYTICS.byName("sniplet_mutated").length).toBe(1);
  });

  it("returns 401 for nonexistent slug", async () => {
    const env = makeEnv();
    const del = new Request("https://api.sniplet.page/v1/sniplets/missing", {
      method: "DELETE",
      headers: { authorization: "Bearer ot_x" },
    });
    const res = await handleDeleteSniplet(del, env, makeCtx(), "missing");
    expect(res.status).toBe(401);
  });
});
