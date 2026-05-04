import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail, normalizeIP } from "../../src/lib/normalize.ts";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Alice@CO.com  ")).toBe("alice@co.com");
  });
});

describe("isValidEmail", () => {
  it("accepts simple emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
  });
  it("rejects malformed", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@")).toBe(false);
    expect(isValidEmail("@b.co")).toBe(false);
  });
});

describe("normalizeIP", () => {
  it("returns IPv4 unchanged", () => {
    expect(normalizeIP("203.0.113.5")).toBe("203.0.113.5");
  });
  it("truncates IPv6 to /64", () => {
    expect(normalizeIP("2001:db8:1234:5678:abcd:ef00:1111:2222")).toBe(
      "2001:0db8:1234:5678",
    );
  });
  it("expands :: shorthand before truncating", () => {
    expect(normalizeIP("2001:db8::1")).toBe("2001:0db8:0000:0000");
  });
});
