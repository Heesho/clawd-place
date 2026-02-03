import { NextResponse } from "next/server";
import { AGENT_MAP_KEY } from "@/lib/constants";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMap(value: Record<string, string | Buffer>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const mapKey = Buffer.isBuffer(key) ? key.toString() : key;
    const mapValue = Buffer.isBuffer(rawValue) ? rawValue.toString() : rawValue;
    normalized[mapKey] = mapValue;
  }
  return normalized;
}

export async function GET() {
  const redis = getRedis();
  const agentMapRaw = await redis.hgetall(AGENT_MAP_KEY);
  const agentMap = normalizeMap(agentMapRaw as Record<string, string | Buffer>);
  return NextResponse.json({ agent_map: agentMap });
}
