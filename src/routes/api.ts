// api.sniplet.page handler. PRD §7.5 routing table.
// PRD §7.20, F-31: this Worker MUST NOT read or log the Cookie header.

import type { Env } from "../types.ts";
import { errorResponse } from "../lib/errors.ts";
import {
  handleDeleteSniplet,
  handlePatchViewers,
  handlePostSniplet,
} from "../handlers/sniplets.ts";
import { handleCspReport } from "../handlers/csp_report.ts";

export async function handleApi(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/v1/sniplets" && req.method === "POST") {
    return handlePostSniplet(req, env, ctx);
  }

  // PATCH /v1/sniplets/:slug/viewers
  const patchMatch = /^\/v1\/sniplets\/([^/]+)\/viewers$/.exec(path);
  if (patchMatch && req.method === "PATCH") {
    return handlePatchViewers(req, env, ctx, patchMatch[1]!);
  }

  // DELETE /v1/sniplets/:slug
  const delMatch = /^\/v1\/sniplets\/([^/]+)$/.exec(path);
  if (delMatch && req.method === "DELETE") {
    return handleDeleteSniplet(req, env, ctx, delMatch[1]!);
  }

  if (path === "/v1/csp-report" && req.method === "POST") {
    return handleCspReport(req, env, ctx);
  }

  return errorResponse(404, "not_found", "Not found");
}
