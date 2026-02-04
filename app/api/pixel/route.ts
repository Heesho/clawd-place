import { NextRequest, NextResponse } from "next/server";
import {
  AGENTS_KEY,
  BITS_PER_PIXEL,
  CANVAS_KEY,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COOLDOWN_SECONDS
} from "@/lib/constants";
import { PALETTE, colorIndexFromHex, normalizeHex } from "@/lib/palette";
import { getRedis } from "@/lib/redis";
import { getSocket } from "@/lib/socket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID_MAX_LENGTH = 64;
const AGENT_ID_PATTERN = /^[\w\-\.]+$/;

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

function getClientIp(req: NextRequest): string | null {
  // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  // Fallback headers
  return req.headers.get("x-real-ip") || req.ip || null;
}

function validateAgentId(agentId: string): string | null {
  if (!agentId || typeof agentId !== "string") {
    return "Agent ID is required";
  }
  if (agentId.length > AGENT_ID_MAX_LENGTH) {
    return `Agent ID exceeds maximum length of ${AGENT_ID_MAX_LENGTH}`;
  }
  if (!AGENT_ID_PATTERN.test(agentId)) {
    return "Agent ID contains invalid characters (only alphanumeric, dash, dot, underscore allowed)";
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Get client IP for rate limiting
  const clientIp = getClientIp(req);
  if (!clientIp) {
    return jsonError("Could not determine client IP", 400);
  }

  // Get agent name for attribution (not verification)
  const agentId = req.headers.get("x-clawd-agent");
  if (!agentId) {
    return jsonError("Missing X-Clawd-Agent header", 400);
  }
  const validationError = validateAgentId(agentId);
  if (validationError) {
    return jsonError(validationError, 400);
  }

  let payload: { x?: unknown; y?: unknown; color?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON payload", 400);
  }

  const { x: rawX, y: rawY, color } = payload ?? {};

  if (!Number.isInteger(rawX) || !Number.isInteger(rawY)) {
    return jsonError("x and y must be integers", 400);
  }

  const x = rawX as number;
  const y = rawY as number;

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

  // Rate limit by IP address
  const redis = getRedis();
  const cooldownKey = `ip:cooldown:${clientIp}`;
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
  const pixelKey = `${x},${y}`;

  const pipeline = redis.multi();
  pipeline.bitfield(CANVAS_KEY, "SET", `u${BITS_PER_PIXEL}`, colorOffset, colorIndex);
  pipeline.hset(AGENTS_KEY, pixelKey, agentId);
  const results = await pipeline.exec();

  if (!results || results.some(([err]) => err !== null)) {
    console.error("[Pixel] Pipeline execution failed:", results);
    return jsonError("Failed to save pixel", 500);
  }

  const timestamp = Date.now();
  const io = getSocket();
  if (io) {
    io.emit("pixel", {
      x,
      y,
      color: normalizedColor,
      agent_id: agentId,
      ts: timestamp
    });
  }

  return NextResponse.json({
    ok: true,
    x,
    y,
    color: normalizedColor,
    agent_id: agentId,
    ts: timestamp
  });
}
