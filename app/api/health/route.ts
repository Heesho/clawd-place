import { NextResponse } from "next/server";
import { getRedis, isRedisReady } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: "ok" | "error"; latency_ms?: number; error?: string }> = {};

  // Check Redis connectivity
  const redisStart = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    checks.redis = {
      status: "ok",
      latency_ms: Date.now() - redisStart
    };
  } catch (err) {
    checks.redis = {
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error"
    };
  }

  const healthy = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "unhealthy",
      redis_ready: isRedisReady(),
      checks,
      timestamp: new Date().toISOString()
    },
    { status: healthy ? 200 : 503 }
  );
}
