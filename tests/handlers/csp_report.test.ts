import { describe, expect, it } from "vitest";
import { handleCspReport } from "../../src/handlers/csp_report.ts";
import { makeCtx, makeEnv } from "../helpers/mockEnv.ts";

function makeCspReq(
  body: unknown,
  ct = "application/csp-report",
  bodyOverride?: string,
  ip = "203.0.113.1",
): Request {
  const text = bodyOverride ?? JSON.stringify(body);
  return new Request("https://api.sniplet.page/v1/csp-report", {
    method: "POST",
    headers: {
      "content-type": ct,
      "cf-connecting-ip": ip,
    },
    body: text,
  });
}

describe("POST /v1/csp-report", () => {
  it("204 on valid report", async () => {
    const env = makeEnv();
    const req = makeCspReq({
      "csp-report": {
        "blocked-uri": "https://evil.com/x",
        "violated-directive": "connect-src",
      },
    });
    const res = await handleCspReport(req, env, makeCtx());
    expect(res.status).toBe(204);
    expect(env.__mocks.ANALYTICS.byName("csp_violation")).toHaveLength(1);
  });

  it("accepts application/json CT", async () => {
    const env = makeEnv();
    const req = makeCspReq(
      { "csp-report": { "blocked-uri": "x" } },
      "application/json",
    );
    const res = await handleCspReport(req, env, makeCtx());
    expect(res.status).toBe(204);
  });

  it("rejects text/plain CT", async () => {
    const env = makeEnv();
    const req = makeCspReq(
      { "csp-report": { "blocked-uri": "x" } },
      "text/plain",
    );
    const res = await handleCspReport(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_content_type");
  });

  it("rejects body > 8KB (413)", async () => {
    const env = makeEnv();
    const huge = "x".repeat(10_000);
    const req = makeCspReq(undefined, "application/csp-report", huge);
    const res = await handleCspReport(req, env, makeCtx());
    expect(res.status).toBe(413);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("payload_too_large");
  });

  it("rejects malformed JSON", async () => {
    const env = makeEnv();
    const req = makeCspReq(undefined, "application/csp-report", "not-json");
    const res = await handleCspReport(req, env, makeCtx());
    expect(res.status).toBe(400);
  });

  it("rate-limits per-IP > 100/min", async () => {
    const env = makeEnv();
    const ip = "203.0.113.99";
    let lastStatus = 204;
    for (let i = 0; i < 105; i++) {
      const req = makeCspReq(
        { "csp-report": { "blocked-uri": "x" } },
        "application/csp-report",
        undefined,
        ip,
      );
      const r = await handleCspReport(req, env, makeCtx());
      lastStatus = r.status;
    }
    expect(lastStatus).toBe(429);
    expect(env.__mocks.ANALYTICS.byName("csp_report_rate_limited").length).toBeGreaterThan(0);
  });
});
