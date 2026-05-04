// PRD §8 — return_to validator. Open redirect prevention.

export const APEX_RETURN = "https://sniplet.page/";

export function validateReturnTo(r: string | undefined | null): boolean {
  if (!r) return false;
  let url: URL;
  try {
    url = new URL(r);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.search || url.hash) return false;
  if (url.pathname !== "/") return false;
  if (url.hostname === "sniplet.page") return true;
  // Postfixed slug subdomain: 8–45 chars total host base.
  return /^[a-z0-9](?!.*--)[a-z0-9-]{6,43}[a-z0-9]\.sniplet\.page$/.test(url.hostname);
}

export function safeReturnTo(r: string | undefined | null): string {
  return validateReturnTo(r) ? (r as string) : APEX_RETURN;
}
