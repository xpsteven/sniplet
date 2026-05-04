// HS256 JWT — sign + verify with strict algorithm enforcement.
// PRD §7.13:
//   - Algorithm MUST === "HS256". Reject "none" and any non-HS256 value.
//   - `purpose` MUST match expected value (session/magic).
//   - Session vs magic use *different* secrets — even if purpose check is missed,
//     a magic token cannot pass session verification.

import { base64urlDecode, base64urlEncode, hmacSha256 } from "./crypto.ts";
import { timingSafeEqualBytes } from "./timingSafe.ts";

const enc = new TextEncoder();

export type JwtPurpose = "session" | "magic";

export interface JwtClaims {
  sub: string;
  purpose: JwtPurpose;
  iat: number;
  exp: number;
  v: number;
  // magic-only:
  jti?: string;
  return_to?: string;
}

export async function signJwt(claims: JwtClaims, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(claims)));
  const data = `${headerB64}.${payloadB64}`;
  const sig = await hmacSha256(secret, data);
  return `${data}.${base64urlEncode(new Uint8Array(sig))}`;
}

export interface VerifyOptions {
  expectedPurpose: JwtPurpose;
  now?: number; // seconds since epoch — for tests
}

export type VerifyResult =
  | { ok: true; claims: JwtClaims }
  | { ok: false; reason: "malformed" | "bad_alg" | "bad_signature" | "bad_purpose" | "expired" };

export async function verifyJwt(
  token: string,
  secret: string,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let payload: JwtClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // PRD §7.13 — MUST reject any alg other than HS256.
  if (header.alg !== "HS256") return { ok: false, reason: "bad_alg" };

  // Verify signature with constant-time compare.
  const expected = new Uint8Array(await hmacSha256(secret, `${headerB64}.${payloadB64}`));
  let actual: Uint8Array;
  try {
    actual = base64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqualBytes(expected, actual)) return { ok: false, reason: "bad_signature" };

  if (payload.purpose !== opts.expectedPurpose) return { ok: false, reason: "bad_purpose" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims: payload };
}
