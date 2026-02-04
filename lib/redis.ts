import Redis from "ioredis";

const globalForRedis = globalThis as typeof globalThis & {
  _redis?: Redis;
  _redisReady?: boolean;
};

function validateRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (process.env.NODE_ENV === "production" && !url) {
    throw new Error("REDIS_URL environment variable is required in production");
  }
  return url ?? "redis://localhost:6379";
}

export function getRedis(): Redis {
  if (!globalForRedis._redis) {
    const url = validateRedisUrl();
    const redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
      }
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
      globalForRedis._redisReady = false;
    });

    redis.on("connect", () => {
      console.log("[Redis] Connected");
      globalForRedis._redisReady = true;
    });

    redis.on("close", () => {
      console.log("[Redis] Connection closed");
      globalForRedis._redisReady = false;
    });

    globalForRedis._redis = redis;
  }
  return globalForRedis._redis;
}

export function isRedisReady(): boolean {
  return globalForRedis._redisReady ?? false;
}
