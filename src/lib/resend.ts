// Thin Resend client — only the one endpoint we need (POST /emails).

const RESEND_URL = "https://api.resend.com/emails";

export interface ResendError {
  ok: false;
  status: number;
  errorCode?: string;
}

export interface ResendOk {
  ok: true;
  id: string;
}

export type ResendResult = ResendOk | ResendError;

export interface SendEmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendResendEmail(
  apiKey: string,
  input: SendEmailInput,
): Promise<ResendResult> {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });
  if (!res.ok) {
    const errCode = await res.json().then(
      (b) => (b as { name?: string }).name,
      () => undefined,
    );
    return { ok: false, status: res.status, ...(errCode ? { errorCode: errCode } : {}) };
  }
  const body = (await res.json()) as { id?: string };
  return { ok: true, id: body.id ?? "" };
}
