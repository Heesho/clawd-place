import Redis from "ioredis";

const globalForRedis = globalThis as typeof globalThis & {
  _redis?: Redis;
};

export function getRedis(): Redis {
  if (!globalForRedis._redis) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    globalForRedis._redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true
    });
  }
  return globalForRedis._redis;
}
