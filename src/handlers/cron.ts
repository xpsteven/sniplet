// PRD §7.4 — daily UTC 02:00 cleanup.

import type { Env, SnipletMeta } from "../types.ts";
import { track } from "../lib/analytics.ts";
import { removeFromEmailIndex } from "../lib/kv.ts";
import { deleteSniplet, readMeta } from "../lib/r2.ts";

const META_PREFIX = "sniplets/";

export async function handleCron(
  _controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const now = Date.now();
  let deleted = 0;
  let cursor: string | undefined;

  // R2 list pagination — list all meta.json objects.
  do {
    const opts: R2ListOptions = { prefix: META_PREFIX, limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const page = await env.SNIPLETS.list(opts);
    for (const obj of page.objects) {
      // We list both index.html and meta.json under the prefix; only act on meta.
      if (!obj.key.endsWith("/meta.json")) continue;
      const slug = extractSlugFromMetaKey(obj.key);
      if (!slug) continue;

      const meta = await readMeta(env.SNIPLETS, slug);
      if (!meta) continue;
      const expiresMs = new Date(meta.expires_at).getTime();
      if (!Number.isFinite(expiresMs) || expiresMs > now) continue;

      // Expired — purge.
      await deleteSniplet(env.SNIPLETS, slug);
      if (meta.viewers) {
        for (const v of meta.viewers) {
          await removeFromEmailIndex(env.EMAIL_INDEX_KV, v.h, slug);
        }
      }
      deleted++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  track(env.ANALYTICS, "cron_cleanup_success", { doubles: [deleted] });
}

function extractSlugFromMetaKey(key: string): string | null {
  // sniplets/<slug>/meta.json
  const m = /^sniplets\/([^/]+)\/meta\.json$/.exec(key);
  return m ? m[1]! : null;
}

// Suppress unused-locals warning for SnipletMeta if type narrowing infers it.
void (null as unknown as SnipletMeta);
