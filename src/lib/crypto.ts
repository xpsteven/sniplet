// Crypto primitives wrapping Web Crypto API.
// PRD §7.10 (HMAC email index), §7.13 (JWT HS256), §7.14 (owner_token), §7.15 (postfix).

const enc = new TextEncoder();

export async function hmacSha256(secret: string, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, enc.encode(msg));
}

export async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  return bytesToHex(new Uint8Array(await hmacSha256(secret, msg)));
}

export async function sha256(msg: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", enc.encode(msg));
}

export async function sha256Hex(msg: string): Promise<string> {
  return bytesToHex(new Uint8Array(await sha256(msg)));
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]!;
    hex += v.toString(16).padStart(2, "0");
  }
  return hex;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

const POSTFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// PRD §7.15: postfix MUST come from crypto.getRandomValues(); no counter / timestamp.
export function generatePostfix(len: number): string {
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += POSTFIX_ALPHABET[buf[i]! % POSTFIX_ALPHABET.length];
  }
  return out;
}

// PRD §7.14: owner_token = "ot_" + base64url(32 bytes).
export function generateOwnerToken(): string {
  return "ot_" + base64urlEncode(randomBytes(32));
}
