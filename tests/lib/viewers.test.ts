import { describe, expect, it } from "vitest";
import {
  maskEmail,
  normalizeViewer,
  normalizeViewerList,
  viewersToEntries,
} from "../../src/lib/viewers.ts";

const SECRET = "test-email-hash";

describe("maskEmail", () => {
  it("formats as first-char + *** + @domain", () => {
    expect(maskEmail("alice@co.com")).toBe("a***@co.com");
  });
  it("normalizes case before masking", () => {
    expect(maskEmail("Alice@CO.com")).toBe("a***@co.com");
  });
});

describe("normalizeViewer", () => {
  it("returns deterministic HMAC + masked", async () => {
    const a = await normalizeViewer(SECRET, "Alice@CO.com");
    const b = await normalizeViewer(SECRET, "alice@co.com");
    expect(a?.hmacHex).toBe(b?.hmacHex);
    expect(a?.masked).toBe("a***@co.com");
  });
  it("returns null for invalid email", async () => {
    expect(await normalizeViewer(SECRET, "not-an-email")).toBe(null);
  });
});

describe("normalizeViewerList", () => {
  it("dedupes by HMAC", async () => {
    const r = await normalizeViewerList(SECRET, ["a@b.co", "A@B.co"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.viewers).toHaveLength(1);
  });
  it("rejects on first invalid", async () => {
    const r = await normalizeViewerList(SECRET, ["a@b.co", "bad"]);
    expect(r.ok).toBe(false);
  });
});

describe("viewersToEntries", () => {
  it("maps to {h,m} structure", async () => {
    const r = await normalizeViewerList(SECRET, ["a@b.co"]);
    if (!r.ok) throw new Error("setup");
    const entries = viewersToEntries(r.viewers);
    expect(entries[0]).toEqual({ h: r.viewers[0]!.hmacHex, m: "a***@b.co" });
  });
});
