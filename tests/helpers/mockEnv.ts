// Minimal in-memory mocks for KV + R2 + Analytics — sufficient for handler-level
// unit tests that don't depend on Workers runtime semantics. For end-to-end
// behaviour against the actual runtime, Phase 8 will use vitest-pool-workers.

import type { Env } from "../../src/types.ts";

export class MockKV {
  private map = new Map<string, { value: string; expireAt?: number }>();
  async get(key: string, type?: "json"): Promise<string | null | unknown> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expireAt && e.expireAt < Date.now()) {
      this.map.delete(key);
      return null;
    }
    if (type === "json") return JSON.parse(e.value);
    return e.value;
  }
  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void> {
    const expireAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined;
    const entry: { value: string; expireAt?: number } = expireAt !== undefined
      ? { value, expireAt }
      : { value };
    this.map.set(key, entry);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  // Inspection helpers for tests:
  _all(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [k, v] of this.map) out.set(k, v.value);
    return out;
  }
  _size(): number {
    return this.map.size;
  }
}

class MockR2Object {
  constructor(public body: string, public contentType: string) {}
  text(): Promise<string> {
    return Promise.resolve(this.body);
  }
  json<T>(): Promise<T> {
    return Promise.resolve(JSON.parse(this.body) as T);
  }
}

export class MockR2 {
  private map = new Map<string, MockR2Object>();
  async get(key: string): Promise<MockR2Object | null> {
    return this.map.get(key) ?? null;
  }
  async put(
    key: string,
    body: string,
    opts?: { onlyIf?: { etagDoesNotMatch?: string }; httpMetadata?: { contentType?: string } },
  ): Promise<{ etag: string } | null> {
    if (opts?.onlyIf?.etagDoesNotMatch === "*" && this.map.has(key)) {
      return null; // collision signal
    }
    this.map.set(key, new MockR2Object(body, opts?.httpMetadata?.contentType ?? ""));
    return { etag: '"etag"' };
  }
  async delete(keys: string | string[]): Promise<void> {
    if (typeof keys === "string") {
      this.map.delete(keys);
    } else {
      for (const k of keys) this.map.delete(k);
    }
  }
  _has(key: string): boolean {
    return this.map.has(key);
  }
  _size(): number {
    return this.map.size;
  }
  async _peekMeta<T>(key: string): Promise<T | null> {
    const o = this.map.get(key);
    if (!o) return null;
    return JSON.parse(o.body) as T;
  }
}

export class MockAnalytics {
  events: Array<{ blobs: string[]; doubles: number[]; indexes: string[] }> = [];
  writeDataPoint(p: { blobs?: (string | undefined | null)[]; doubles?: number[]; indexes?: string[] }): void {
    this.events.push({
      blobs: (p.blobs ?? []).map((b) => b ?? ""),
      doubles: p.doubles ?? [],
      indexes: p.indexes ?? [],
    });
  }
  byName(name: string) {
    return this.events.filter((e) => e.blobs[0] === name);
  }
}

export interface TestEnv extends Env {
  // Expose mock instances for assertions.
  __mocks: {
    SNIPLETS: MockR2;
    METER_KV: MockKV;
    EMAIL_INDEX_KV: MockKV;
    MAGIC_CONSUMED_KV: MockKV;
    ANALYTICS: MockAnalytics;
  };
}

export function makeEnv(over: Partial<Env> = {}): TestEnv {
  const SNIPLETS = new MockR2();
  const METER_KV = new MockKV();
  const EMAIL_INDEX_KV = new MockKV();
  const MAGIC_CONSUMED_KV = new MockKV();
  const ANALYTICS = new MockAnalytics();

  const env: TestEnv = {
    SNIPLETS: SNIPLETS as unknown as R2Bucket,
    METER_KV: METER_KV as unknown as KVNamespace,
    EMAIL_INDEX_KV: EMAIL_INDEX_KV as unknown as KVNamespace,
    MAGIC_CONSUMED_KV: MAGIC_CONSUMED_KV as unknown as KVNamespace,
    ANALYTICS: ANALYTICS as unknown as AnalyticsEngineDataset,
    ENVIRONMENT: "dev",
    SESSION_JWT_SECRET: "test-session",
    MAGIC_JWT_SECRET: "test-magic",
    EMAIL_HASH_SECRET: "test-email-hash",
    IP_HASH_SECRET: "test-ip-hash",
    RESEND_API_KEY: "test-resend",
    TURNSTILE_SECRET: "test-turnstile",
    TURNSTILE_SITE_KEY: "test-turnstile-site",
    ...over,
    __mocks: {
      SNIPLETS,
      METER_KV,
      EMAIL_INDEX_KV,
      MAGIC_CONSUMED_KV,
      ANALYTICS,
    },
  };
  return env;
}

export function makeCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}

export function makeJsonReq(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });
}
