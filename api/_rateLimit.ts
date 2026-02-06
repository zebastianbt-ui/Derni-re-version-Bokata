type RateLimitResult = { ok: boolean; remaining: number; resetAt: number; source: "memory" | "upstash" };

const memoryStore = new Map<string, { count: number; resetAt: number }>();

const getUpstashConfig = () => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
};

const memoryLimit = (key: string, max: number, windowMs: number): RateLimitResult => {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    memoryStore.set(key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, max - 1), resetAt, source: "memory" };
  }
  if (entry.count >= max) return { ok: false, remaining: 0, resetAt: entry.resetAt, source: "memory" };
  entry.count += 1;
  return { ok: true, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt, source: "memory" };
};

const upstashLimit = async (key: string, max: number, windowMs: number): Promise<RateLimitResult | null> => {
  const cfg = getUpstashConfig();
  if (!cfg) return null;
  try {
    const pipeline = [
      ["INCR", key],
      ["PTTL", key],
    ];
    const resp = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pipeline),
    });
    const data = (await resp.json()) as Array<{ result?: number; error?: string }>;
    const count = Number(data?.[0]?.result ?? 0);
    let ttl = Number(data?.[1]?.result ?? -1);
    if (ttl < 0) {
      await fetch(`${cfg.url}/pexpire/${encodeURIComponent(key)}/${windowMs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      ttl = windowMs;
    }
    const resetAt = Date.now() + Math.max(0, ttl);
    return { ok: count <= max, remaining: Math.max(0, max - count), resetAt, source: "upstash" };
  } catch {
    return null;
  }
};

export const rateLimit = async (key: string, max: number, windowMs: number): Promise<RateLimitResult> => {
  const upstash = await upstashLimit(key, max, windowMs);
  if (upstash) return upstash;
  return memoryLimit(key, max, windowMs);
};
