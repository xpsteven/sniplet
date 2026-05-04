// sniplet.page apex handler. PRD §7.5 + §10.

import type { Env } from "../types.ts";
import { notFoundPage } from "../pages/notfound.ts";
import { skillMdResponse } from "../pages/skillMd.ts";
import { securityPageResponse, securityTxtResponse } from "../pages/security.ts";
import {
  handleAuthConsume,
  handleAuthLogout,
  handleAuthRequest,
  handleAuthRequestOptions,
  handleAuthVerify,
} from "../handlers/auth.ts";

export async function handleApex(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/" || path === "/SKILL.md")) {
    return skillMdResponse();
  }
  if (req.method === "GET" && path === "/security") {
    return securityPageResponse();
  }
  if (req.method === "GET" && path === "/.well-known/security.txt") {
    return securityTxtResponse();
  }

  if (path === "/auth/request") {
    if (req.method === "OPTIONS") return handleAuthRequestOptions(req);
    if (req.method === "POST") return handleAuthRequest(req, env, ctx);
  }
  if (path === "/auth/verify" && req.method === "GET") {
    return handleAuthVerify(req, env, ctx);
  }
  if (path === "/auth/consume" && req.method === "POST") {
    return handleAuthConsume(req, env, ctx);
  }
  if (path === "/auth/logout" && req.method === "POST") {
    return handleAuthLogout(req, env, ctx);
  }

  return notFoundPage();
}
