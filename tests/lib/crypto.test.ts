import { describe, expect, it } from "vitest";
import {
  base64urlDecode,
  base64urlEncode,
  generateOwnerToken,
  generatePostfix,
  hmacSha256Hex,
  sha256Hex,
} from "../../src/lib/crypto.ts";

describe("crypto", () => {
  it("hmacSha256Hex is deterministic", async () => {
    const a = await hmacSha256Hex("k", "msg");
    const b = await hmacSha256Hex("k", "msg");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("hmacSha256Hex differs by secret", async () => {
    const a = await hmacSha256Hex("k1", "msg");
    const b = await hmacSha256Hex("k2", "msg");
    expect(a).not.toBe(b);
  });

  it("sha256Hex of empty string is the known constant", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("base64url roundtrip preserves bytes", () => {
    const buf = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = base64urlEncode(buf);
    expect(enc).not.toMatch(/[+/=]/);
    const dec = base64urlDecode(enc);
    expect(Array.from(dec)).toEqual(Array.from(buf));
  });

  it("generatePostfix yields lowercase alphanumeric of given length", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePostfix(4);
      expect(p).toHaveLength(4);
      expect(p).toMatch(/^[a-z0-9]{4}$/);
    }
  });

  it("generateOwnerToken has ot_ prefix and ~46 chars", () => {
    const t = generateOwnerToken();
    expect(t.startsWith("ot_")).toBe(true);
    expect(t.length).toBe(46);
  });
});
