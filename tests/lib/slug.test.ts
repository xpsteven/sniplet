import { describe, expect, it } from "vitest";
import {
  appendPostfix,
  isPostfixedSlugHost,
  isReservedSubdomain,
  isValidBaseSlug,
  slugFromHost,
} from "../../src/lib/slug.ts";

describe("isValidBaseSlug", () => {
  it("accepts well-formed slugs", () => {
    expect(isValidBaseSlug("q3-sales")).toBe(true);
    expect(isValidBaseSlug("abc")).toBe(true);
    expect(isValidBaseSlug("a1b2c3")).toBe(true);
  });
  it("rejects too short / too long", () => {
    expect(isValidBaseSlug("ab")).toBe(false);
    expect(isValidBaseSlug("a".repeat(41))).toBe(false);
  });
  it("rejects leading/trailing hyphens", () => {
    expect(isValidBaseSlug("-foo")).toBe(false);
    expect(isValidBaseSlug("foo-")).toBe(false);
  });
  it("rejects consecutive hyphens", () => {
    expect(isValidBaseSlug("foo--bar")).toBe(false);
  });
  it("rejects uppercase / non-ascii", () => {
    expect(isValidBaseSlug("Foo")).toBe(false);
    expect(isValidBaseSlug("café")).toBe(false);
  });
});

describe("isReservedSubdomain", () => {
  it("matches reserved names", () => {
    expect(isReservedSubdomain("api")).toBe(true);
    expect(isReservedSubdomain("admin")).toBe(true);
  });
  it("doesn't match user slugs", () => {
    expect(isReservedSubdomain("q3-sales")).toBe(false);
  });
});

describe("appendPostfix", () => {
  it("appends 4-char postfix with hyphen", () => {
    const r = appendPostfix("q3-sales");
    expect(r).toMatch(/^q3-sales-[a-z0-9]{4}$/);
  });
});

describe("isPostfixedSlugHost", () => {
  it("matches valid postfixed subdomains", () => {
    expect(isPostfixedSlugHost("q3-sales-a7k2.sniplet.page")).toBe(true);
    expect(isPostfixedSlugHost("abc-1234.sniplet.page")).toBe(true);
  });
  it("rejects non-sniplet domains", () => {
    expect(isPostfixedSlugHost("evil.com")).toBe(false);
    expect(isPostfixedSlugHost("api.sniplet.page")).toBe(false); // 3-char base, but 'api' becomes < 8 char host
  });
  it("rejects too-short / too-long", () => {
    expect(isPostfixedSlugHost("ab.sniplet.page")).toBe(false);
  });
});

describe("slugFromHost", () => {
  it("returns slug for sniplet subdomain", () => {
    expect(slugFromHost("q3-sales-a7k2.sniplet.page")).toBe("q3-sales-a7k2");
  });
  it("returns null for apex", () => {
    expect(slugFromHost("sniplet.page")).toBe(null);
  });
  it("returns null for nested subdomain", () => {
    expect(slugFromHost("a.b.sniplet.page")).toBe(null);
  });
  it("returns null for non-sniplet", () => {
    expect(slugFromHost("evil.com")).toBe(null);
  });
});
