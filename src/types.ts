export interface Env {
  // Bindings
  SNIPLETS: R2Bucket;
  METER_KV: KVNamespace;
  EMAIL_INDEX_KV: KVNamespace;
  MAGIC_CONSUMED_KV: KVNamespace;
  ANALYTICS: AnalyticsEngineDataset | undefined;

  // Vars
  ENVIRONMENT: "dev" | "prod";

  // Secrets
  SESSION_JWT_SECRET: string;
  MAGIC_JWT_SECRET: string;
  EMAIL_HASH_SECRET: string;
  IP_HASH_SECRET: string;
  RESEND_API_KEY: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
}

export type AccessMode = "public" | "email-gated";

export interface ViewerEntry {
  h: string; // HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email)) hex
  m: string; // masked: "{first}***@{domain}"
}

export interface SnipletMeta {
  created_at: string;
  expires_at: string;
  ip_hash: string;
  owner_token_hash: string;
  viewers: ViewerEntry[] | null;
}
