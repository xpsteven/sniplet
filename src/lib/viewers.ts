// Viewer email handling — PRD §7.9 (HMAC + masked storage), §7.10 (KV index).

import { hmacSha256Hex } from "./crypto.ts";
import { isValidEmail, normalizeEmail } from "./normalize.ts";
import type { ViewerEntry } from "../types.ts";

export function maskEmail(email: string): string {
  // Spec: "{first-char}***@{domain}" — operate on the *normalized* form so the
  // mask is stable between POST input and stored representation.
  const norm = normalizeEmail(email);
  const at = norm.indexOf("@");
  if (at <= 0) return "***@***"; // shouldn't happen post-validation
  const first = norm[0]!;
  const domain = norm.slice(at + 1);
  return `${first}***@${domain}`;
}

export interface NormalizedViewer {
  hmacHex: string;
  masked: string;
}

export async function normalizeViewer(
  emailHashSecret: string,
  email: string,
): Promise<NormalizedViewer | null> {
  const norm = normalizeEmail(email);
  if (!isValidEmail(norm)) return null;
  const hmacHex = await hmacSha256Hex(emailHashSecret, norm);
  return { hmacHex, masked: maskEmail(norm) };
}

export async function normalizeViewerList(
  emailHashSecret: string,
  emails: string[],
): Promise<{ ok: true; viewers: NormalizedViewer[] } | { ok: false; reason: "invalid_email" }> {
  const out: NormalizedViewer[] = [];
  const seen = new Set<string>();
  for (const e of emails) {
    const v = await normalizeViewer(emailHashSecret, e);
    if (!v) return { ok: false, reason: "invalid_email" };
    if (seen.has(v.hmacHex)) continue; // dedupe — same email twice
    seen.add(v.hmacHex);
    out.push(v);
  }
  return { ok: true, viewers: out };
}

export function viewersToEntries(vs: NormalizedViewer[]): ViewerEntry[] {
  return vs.map((v) => ({ h: v.hmacHex, m: v.masked }));
}

export function entriesToMaskedList(vs: ViewerEntry[]): string[] {
  return vs.map((v) => v.m);
}
