// {slug}.sniplet.page handler. PRD §7.5 + §7.7 (private flow) + §8.

import type { Env } from "../types.ts";
import { handleSnipletGet } from "../handlers/sniplet_get.ts";

export async function handleSniplet(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return handleSnipletGet(req, env, ctx);
}
