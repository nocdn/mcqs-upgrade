import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("connect", () => {
  console.log("[redis] Connected");
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

export const CACHE_TTL = 86400;

export async function getCached<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = CACHE_TTL
): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached) {
      console.log(`Cache HIT: ${key}`);
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    console.error("Redis get error:", err);
  }

  console.log(`Cache MISS: ${key}`);
  const data = await fetchFn();

  try {
    await redis.set(key, JSON.stringify(data), "EX", ttl);
  } catch (err) {
    console.error("Redis set error:", err);
  }

  return data;
}

export async function invalidateCache(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`Invalidated ${keys.length} cache keys matching: ${pattern}`);
    }
  } catch (err) {
    console.error("Redis invalidate error:", err);
  }
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    const ttl = await redis.ttl(key);
    const resetAt = Date.now() + ttl * 1000;

    if (current > limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    return { allowed: true, remaining: limit - current, resetAt };
  } catch (err) {
    console.error("Rate limit check error:", err);
    return {
      allowed: true,
      remaining: limit,
      resetAt: Date.now() + windowSeconds * 1000,
    };
  }
}
