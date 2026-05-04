// PRD §7.10: email normalize for KV index + viewers HMAC.
// PRD §7.17: IPv6 normalize to /64 to defeat per-IP rotation.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Crude email validator — RFC 5322 superset is intentionally not used.
// We only need to reject obviously malformed input; the magic link delivery itself
// validates the address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

// IPv6 /64 = first 4 groups (16 hex chars + 3 colons). IPv4 keeps full /32.
export function normalizeIP(ip: string): string {
  if (!ip.includes(":")) return ip; // IPv4
  // Expand "::" to full form, then truncate to /64.
  const expanded = expandIPv6(ip);
  if (!expanded) return ip; // malformed — caller should treat as a single IP
  const groups = expanded.split(":");
  return groups.slice(0, 4).join(":");
}

function expandIPv6(ip: string): string | null {
  // Split on "::" — at most one occurrence.
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const total = head.length + tail.length;
  if (total > 8) return null;
  const fillCount = 8 - total;
  const fill: string[] = [];
  for (let i = 0; i < fillCount; i++) fill.push("0");
  const all = parts.length === 2 ? [...head, ...fill, ...tail] : head;
  if (all.length !== 8) return null;
  return all.map((g) => g.padStart(4, "0")).join(":");
}
