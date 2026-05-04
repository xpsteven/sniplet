// R2 helpers — PRD §7.9, §7.15 F-34 create-only put.
//
// PRD §7.15 F-34: every write MUST use `onlyIf: { etagDoesNotMatch: '*' }` to
// detect collisions atomically. Forbidden alternative: head-then-put (TOCTOU).

import type { SnipletMeta } from "../types.ts";

export const HTML_KEY = (slug: string) => `sniplets/${slug}/index.html`;
export const META_KEY = (slug: string) => `sniplets/${slug}/meta.json`;

// PreconditionFailed is the signal we expect when the slug+postfix collides
// with an existing object. R2 surfaces this either as a thrown R2Error with
// status 412 or as a null return (depending on runtime path); we treat both
// as "collision".
export class R2Collision extends Error {
  constructor() {
    super("R2 onlyIf precondition failed");
  }
}

export async function putHtmlCreateOnly(
  bucket: R2Bucket,
  slug: string,
  html: string,
): Promise<void> {
  const res = await bucket.put(HTML_KEY(slug), html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    onlyIf: { etagDoesNotMatch: "*" },
  } satisfies R2PutOptions);
  if (res === null) throw new R2Collision();
}

export async function putMetaCreateOnly(
  bucket: R2Bucket,
  slug: string,
  meta: SnipletMeta,
): Promise<void> {
  const res = await bucket.put(META_KEY(slug), JSON.stringify(meta), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    onlyIf: { etagDoesNotMatch: "*" },
  } satisfies R2PutOptions);
  if (res === null) throw new R2Collision();
}

// Used by PATCH viewers — overwrite is allowed once the owner is verified.
export async function overwriteMeta(
  bucket: R2Bucket,
  slug: string,
  meta: SnipletMeta,
): Promise<void> {
  await bucket.put(META_KEY(slug), JSON.stringify(meta), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

export async function readMeta(bucket: R2Bucket, slug: string): Promise<SnipletMeta | null> {
  const obj = await bucket.get(META_KEY(slug));
  if (!obj) return null;
  try {
    return (await obj.json()) as SnipletMeta;
  } catch {
    return null;
  }
}

export async function readHtml(bucket: R2Bucket, slug: string): Promise<string | null> {
  const obj = await bucket.get(HTML_KEY(slug));
  if (!obj) return null;
  return obj.text();
}

export async function deleteSniplet(bucket: R2Bucket, slug: string): Promise<void> {
  await bucket.delete([HTML_KEY(slug), META_KEY(slug)]);
}
