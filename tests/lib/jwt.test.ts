import { describe, expect, it } from "vitest";
import { signJwt, verifyJwt, type JwtClaims } from "../../src/lib/jwt.ts";
import { base64urlDecode, base64urlEncode } from "../../src/lib/crypto.ts";

const SECRET_A = "test-secret-a";
const SECRET_B = "test-secret-b";

function baseClaims(over: Partial<JwtClaims> = {}): JwtClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "abc",
    purpose: "session",
    iat: now,
    exp: now + 600,
    v: 1,
    ...over,
  };
}

describe("jwt", () => {
  it("sign + verify happy path", async () => {
    const t = await signJwt(baseClaims(), SECRET_A);
    const r = await verifyJwt(t, SECRET_A, { expectedPurpose: "session" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims.sub).toBe("abc");
  });

  it("rejects wrong secret (bad_signature)", async () => {
    const t = await signJwt(baseClaims(), SECRET_A);
    const r = await verifyJwt(t, SECRET_B, { expectedPurpose: "session" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects purpose mismatch (session vs magic)", async () => {
    const t = await signJwt(baseClaims({ purpose: "magic" }), SECRET_A);
    const r = await verifyJwt(t, SECRET_A, { expectedPurpose: "session" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_purpose");
  });

  it("rejects expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const t = await signJwt(baseClaims({ iat: past - 600, exp: past }), SECRET_A);
    const r = await verifyJwt(t, SECRET_A, { expectedPurpose: "session" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects alg=none (PRD §7.13)", async () => {
    const enc = new TextEncoder();
    const header = base64urlEncode(enc.encode(JSON.stringify({ alg: "none", typ: "JWT" })));
    const payload = base64urlEncode(enc.encode(JSON.stringify(baseClaims())));
    const forged = `${header}.${payload}.`;
    const r = await verifyJwt(forged, SECRET_A, { expectedPurpose: "session" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_alg");
  });

  it("rejects malformed token", async () => {
    const r = await verifyJwt("not.a.jwt.token", SECRET_A, { expectedPurpose: "session" });
    expect(r.ok).toBe(false);
  });

  it("decoding a signed token reveals expected payload", async () => {
    const t = await signJwt(baseClaims(), SECRET_A);
    const payloadB64 = t.split(".")[1]!;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    expect(payload.purpose).toBe("session");
    expect(payload.v).toBe(1);
  });
});
