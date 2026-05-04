// Request helpers — IP extraction, safe JSON parse, body size guard.

import { errorResponse } from "./errors.ts";

export function getClientIP(req: Request): string {
  // CF-Connecting-IP is the canonical client IP at the Cloudflare edge.
  return req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

export function todayUTC(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Read body with size cap. Returns Response on cap exceed, else text.
// PRD §7.8 — POST /v1/sniplets HTML 1MB; csp-report 8KB.
export async function readBodyCapped(
  req: Request,
  maxBytes: number,
): Promise<{ text: string } | { tooLarge: true }> {
  // Use Content-Length as a fast pre-check; not all clients set it.
  const cl = req.headers.get("content-length");
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) return { tooLarge: true };
  }
  // Stream-read with cap to enforce against missing/lying CL.
  const reader = req.body?.getReader();
  if (!reader) return { text: "" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) return { tooLarge: true };
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder().decode(merged) };
}

export async function parseJsonBody<T>(
  text: string,
): Promise<{ ok: true; value: T } | { ok: false; res: Response }> {
  try {
    const value = JSON.parse(text) as T;
    if (typeof value !== "object" || value === null) {
      return {
        ok: false,
        res: errorResponse(400, "invalid_format", "Body must be a JSON object"),
      };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, res: errorResponse(400, "invalid_format", "Malformed JSON") };
  }
}
