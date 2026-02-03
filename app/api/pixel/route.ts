import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_KEY,
  AGENT_MAP_KEY,
  BITS_PER_PIXEL,
  CANVAS_KEY,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COOLDOWN_SECONDS
} from "@/lib/constants";
import { hashAgentId, hashToHex } from "@/lib/hash";
import { PALETTE, colorIndexFromHex, normalizeHex } from "@/lib/palette";
import { getRedis } from "@/lib/redis";
import { getSocket } from "@/lib/socket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...details }, { status });
}

function isSetOk(result: unknown): boolean {
  if (!result) {
    return false;
  }
  if (typeof result === "string") {
    return result === "OK";
  }
  if (Buffer.isBuffer(result)) {
    return result.toString() === "OK";
  }
  return false;
}

export async function POST(req: NextRequest) {
  const agentHeader = req.headers.get("x-clawd-agent");
  if (!agentHeader) {
    return jsonError("Missing X-Clawd-Agent header", 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON payload", 400);
  }

  const { x, y, color, token, agent_id } = payload ?? {};

  if (typeof agent_id !== "string" || agent_id.trim().length === 0) {
    return jsonError("Missing agent_id", 400);
  }

  if (agent_id !== agentHeader) {
    return jsonError("Agent header mismatch", 401);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const tokenFromHeader = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const tokenFromBody = typeof token === "string" ? token.trim() : "";

  if (tokenFromHeader && tokenFromBody && tokenFromHeader !== tokenFromBody) {
    return jsonError("Token mismatch", 401);
  }

  const tokenValue = tokenFromHeader || tokenFromBody;
  if (!tokenValue) {
    return jsonError("Missing token", 401);
  }

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return jsonError("x and y must be integers", 400);
  }

  if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) {
    return jsonError("x or y out of bounds", 400, {
      bounds: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
    });
  }

  if (typeof color !== "string") {
    return jsonError("Color must be a hex string", 400);
  }

  const normalizedColor = normalizeHex(color);
  const colorIndex = colorIndexFromHex(normalizedColor);
  if (colorIndex < 0) {
    return jsonError("Color not in palette", 400, { palette: PALETTE });
  }
  if (colorIndex >= 1 << BITS_PER_PIXEL) {
    return jsonError("Color exceeds palette bit depth", 400);
  }

  const redis = getRedis();
  const cooldownKey = `agent:cooldown:${agent_id}`;
  const cooldownSet = await redis.set(cooldownKey, "1", "EX", COOLDOWN_SECONDS, "NX");

  if (!isSetOk(cooldownSet)) {
    return NextResponse.json(
      { error: "Rate limited", retry_after: COOLDOWN_SECONDS },
      {
        status: 429,
        headers: {
          "Retry-After": COOLDOWN_SECONDS.toString()
        }
      }
    );
  }

  const pixelIndex = y * CANVAS_WIDTH + x;
  const colorOffset = pixelIndex * BITS_PER_PIXEL;
  const agentOffset = pixelIndex * 64;
  const agentHash = hashAgentId(agent_id);
  const agentHex = hashToHex(agentHash);

  const pipeline = redis.multi();
  pipeline.bitfield(
    CANVAS_KEY,
    "SET",
    `u${BITS_PER_PIXEL}`,
    colorOffset,
    colorIndex
  );
  pipeline.bitfield(AGENT_KEY, "SET", "u64", agentOffset, agentHash.toString());
  pipeline.hset(AGENT_MAP_KEY, agentHex, agent_id);
  await pipeline.exec();

  const timestamp = Date.now();
  const io = getSocket();
  if (io) {
    io.emit("pixel", {
      x,
      y,
      color: normalizedColor,
      agent_id,
      agent_hash: agentHex,
      ts: timestamp
    });
  }

  return NextResponse.json({
    ok: true,
    x,
    y,
    color: normalizedColor,
    agent_id,
    agent_hash: agentHex,
    ts: timestamp
  });
}
