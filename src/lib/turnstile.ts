// Cloudflare Turnstile server-side verification.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  errorCodes?: string[];
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteip?: string,
): Promise<TurnstileResult> {
  if (!token) return { success: false, errorCodes: ["missing-input-response"] };
  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteip) form.append("remoteip", remoteip);

  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) return { success: false, errorCodes: ["http-error"] };
  const json = (await res.json()) as { success: boolean; "error-codes"?: string[] };
  const codes = json["error-codes"];
  return codes !== undefined
    ? { success: json.success, errorCodes: codes }
    : { success: json.success };
}
