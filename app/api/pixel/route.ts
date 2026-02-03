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

const MOLTBOOK_API = "https://www.moltbook.com/api/v1";
const MOLTBOOK_APP_KEY = process.env.MOLTBOOK_APP_KEY;

type MoltbookAgent = {
  id: string;
  name: string;
  description: string;
  karma: number;
  avatar_url: string;
  claimed: boolean;
  created_at: string;
};

type VerifyResponse = {
  agent: MoltbookAgent;
};

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

async function verifyMoltbookIdentity(token: string): Promise<MoltbookAgent | null> {
  if (!MOLTBOOK_APP_KEY) {
    return null;
  }

  try {
    const response = await fetch(`${MOLTBOOK_API}/agents/verify-identity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Moltbook-App-Key": MOLTBOOK_APP_KEY
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as VerifyResponse;
    return data.agent;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const identityToken = req.headers.get("x-moltbook-identity");

  let agentId: string;
  let verified = false;

  if (MOLTBOOK_APP_KEY) {
    if (!identityToken) {
      return jsonError("Missing X-Moltbook-Identity header", 401, {
        hint: "Get an identity token from POST https://www.moltbook.com/api/v1/agents/me/identity-token"
      });
    }

    const agent = await verifyMoltbookIdentity(identityToken);
    if (!agent) {
      return jsonError("Invalid or expired identity token", 401);
    }

    agentId = agent.name;
    verified = true;
  } else {
    const fallbackHeader = req.headers.get("x-clawd-agent");
    if (!fallbackHeader) {
      return jsonError("Missing X-Clawd-Agent header", 401);
    }
    agentId = fallbackHeader;
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON payload", 400);
  }

  const { x, y, color } = payload ?? {};

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
  const cooldownKey = `agent:cooldown:${agentId}`;
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
  await pipeline.exec();

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
    verified,
    ts: timestamp
  });
}
