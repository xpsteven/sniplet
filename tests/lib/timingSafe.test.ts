import { describe, expect, it } from "vitest";
import { timingSafeEqualBytes, timingSafeEqualHex } from "../../src/lib/timingSafe.ts";

describe("timingSafeEqual", () => {
  it("bytes: equal for same content", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });
  it("bytes: false for length mismatch", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });
  it("bytes: false for content mismatch", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });
  it("hex: equal", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbeef")).toBe(true);
  });
  it("hex: false", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbeed")).toBe(false);
  });
});
