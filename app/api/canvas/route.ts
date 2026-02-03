import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_BYTES,
  AGENT_KEY,
  AGENT_MAP_KEY,
  BITS_PER_PIXEL,
  CANVAS_HEIGHT,
  CANVAS_KEY,
  CANVAS_WIDTH,
  TOTAL_PIXELS
} from "@/lib/constants";
import { PALETTE } from "@/lib/palette";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

const TOTAL_COLOR_BYTES = Math.ceil((TOTAL_PIXELS * BITS_PER_PIXEL) / 8);
const TOTAL_AGENT_BYTES = TOTAL_PIXELS * AGENT_BYTES;

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

  // 4 bits per pixel: 2 pixels packed per byte
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

function sliceRegionBuffer(
  source: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
  bytesPerPixel: number
): Buffer {
  const rowBytes = width * bytesPerPixel;
  const output = Buffer.alloc(rowBytes * height);

  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * CANVAS_WIDTH + x) * bytesPerPixel;
    const srcEnd = srcStart + rowBytes;
    source.copy(output, row * rowBytes, srcStart, srcEnd);
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

  const [colorBuffer, agentBuffer] = await Promise.all([
    getFullBuffer(CANVAS_KEY, TOTAL_COLOR_BYTES),
    getFullBuffer(AGENT_KEY, TOTAL_AGENT_BYTES)
  ]);

  const colors = unpackColors(colorBuffer);
  const slicedColors = sliceRegionFromArray(colors, x, y, width, height);
  const slicedAgents = sliceRegionBuffer(agentBuffer, x, y, width, height, AGENT_BYTES);

  const redis = getRedis();
  const agentMapRaw = await redis.hgetall(AGENT_MAP_KEY);
  const agentMap = normalizeMap(agentMapRaw as Record<string, string | Buffer>);

  return NextResponse.json({
    x,
    y,
    width,
    height,
    palette: PALETTE,
    format: {
      color: "palette_index_u8",
      agent: "u64_hash"
    },
    storage: {
      bits_per_pixel: BITS_PER_PIXEL
    },
    colors: Buffer.from(slicedColors).toString("base64"),
    agents: slicedAgents.toString("base64"),
    agent_map: agentMap
  });
}
