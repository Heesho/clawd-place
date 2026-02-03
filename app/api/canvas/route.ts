import { NextRequest, NextResponse } from "next/server";
import {
  AGENTS_KEY,
  BITS_PER_PIXEL,
  CANVAS_HEIGHT,
  CANVAS_KEY,
  CANVAS_WIDTH,
  TOTAL_PIXELS
} from "@/lib/constants";
import { PALETTE } from "@/lib/palette";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOTAL_COLOR_BYTES = Math.ceil((TOTAL_PIXELS * BITS_PER_PIXEL) / 8);

function parseIntParam(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getRangeBuffer(
  key: string,
  start: number,
  end: number
): Promise<Buffer> {
  const redis = getRedis();
  const anyRedis = redis as any;
  if (typeof anyRedis.callBuffer === "function") {
    return (await anyRedis.callBuffer("GETRANGE", key, start, end)) as Buffer;
  }
  const result = await redis.getrange(key, start, end);
  if (Buffer.isBuffer(result)) {
    return result;
  }
  return Buffer.from(result ?? "", "binary");
}

async function getFullBuffer(key: string, expectedSize: number): Promise<Buffer> {
  const buffer = await getRangeBuffer(key, 0, expectedSize - 1);
  if (!buffer || buffer.length === 0) {
    return Buffer.alloc(expectedSize);
  }
  if (buffer.length < expectedSize) {
    const padded = Buffer.alloc(expectedSize);
    buffer.copy(padded);
    return padded;
  }
  return buffer;
}

function unpackColors(buffer: Buffer): Uint8Array {
  const colors = new Uint8Array(TOTAL_PIXELS);

  for (let i = 0; i < TOTAL_PIXELS; i += 1) {
    const byte = buffer[i >> 1] ?? 0;
    colors[i] = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
  }

  return colors;
}

function sliceRegionFromArray(
  source: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number
): Uint8Array {
  const output = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const srcStart = (y + row) * CANVAS_WIDTH + x;
    const srcEnd = srcStart + width;
    output.set(source.subarray(srcStart, srcEnd), row * width);
  }
  return output;
}

function normalizeMap(value: Record<string, string | Buffer>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const mapKey = Buffer.isBuffer(key) ? key.toString() : key;
    const mapValue = Buffer.isBuffer(rawValue) ? rawValue.toString() : rawValue;
    normalized[mapKey] = mapValue;
  }
  return normalized;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const x = parseIntParam(searchParams.get("x"), 0);
  const y = parseIntParam(searchParams.get("y"), 0);
  const width = parseIntParam(searchParams.get("w"), CANVAS_WIDTH);
  const height = parseIntParam(searchParams.get("h"), CANVAS_HEIGHT);

  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    return NextResponse.json({ error: "Invalid region" }, { status: 400 });
  }

  if (x + width > CANVAS_WIDTH || y + height > CANVAS_HEIGHT) {
    return NextResponse.json({ error: "Region out of bounds" }, { status: 400 });
  }

  const redis = getRedis();

  const [colorBuffer, agentsRaw] = await Promise.all([
    getFullBuffer(CANVAS_KEY, TOTAL_COLOR_BYTES),
    redis.hgetall(AGENTS_KEY)
  ]);

  const colors = unpackColors(colorBuffer);
  const slicedColors = sliceRegionFromArray(colors, x, y, width, height);
  const agents = normalizeMap(agentsRaw as Record<string, string | Buffer>);

  return NextResponse.json({
    x,
    y,
    width,
    height,
    palette: PALETTE,
    colors: Buffer.from(slicedColors).toString("base64"),
    agents
  });
}
