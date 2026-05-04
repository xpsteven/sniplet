// Worker entry — hostname-based dispatch (PRD §7.5).

import type { Env } from "./types.ts";
import { handleApi } from "./routes/api.ts";
import { handleApex } from "./routes/apex.ts";
import { handleSniplet } from "./routes/sniplet.ts";
import { handleCron } from "./handlers/cron.ts";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const host = url.hostname;

    // HTTP semantics: HEAD MUST return the same headers as GET, sans body.
    // Forward the request as GET to the handler, then strip the body.
    const isHead = req.method === "HEAD";
    const fwdReq = isHead
      ? new Request(req.url, { method: "GET", headers: req.headers })
      : req;

    let res: Response;
    if (host === "api.sniplet.page") res = await handleApi(fwdReq, env, ctx);
    else if (host === "sniplet.page") res = await handleApex(fwdReq, env, ctx);
    else if (host.endsWith(".sniplet.page")) res = await handleSniplet(fwdReq, env, ctx);
    else res = new Response("Not found", { status: 404 });

    if (isHead) return new Response(null, { status: res.status, headers: res.headers });
    return res;
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return handleCron(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;
