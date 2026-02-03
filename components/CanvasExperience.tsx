"use client";

import clsx from "clsx";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type WheelEvent
} from "react";
import { io, type Socket } from "socket.io-client";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 1000;
const MAX_ACTIVITY = 50;
const HEATMAP_CELL_SIZE = 10;
const HEATMAP_COLS = Math.ceil(CANVAS_WIDTH / HEATMAP_CELL_SIZE);
const HEATMAP_ROWS = Math.ceil(CANVAS_HEIGHT / HEATMAP_CELL_SIZE);
const HEATMAP_MAX_EVENTS = 600;

type CanvasPayload = {
  x: number;
  y: number;
  width: number;
  height: number;
  palette: string[];
  colors: string;
  agents: string;
  agent_map: Record<string, string>;
};

type PixelEvent = {
  x: number;
  y: number;
  color: string;
  agent_id: string;
  agent_hash: string;
  ts: number;
};

type HoverInfo = {
  x: number;
  y: number;
  color: string;
  agent: string;
};

type ActivityItem = {
  id: string;
  text: string;
  ts: number;
};

type FilterStatus = "idle" | "active" | "nomatch";

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function hashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}

function buildAgentList(map: Map<string, string>): string[] {
  return Array.from(new Set(map.values())).sort((a, b) => a.localeCompare(b));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function heatColor(intensity: number): [number, number, number, number] {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  if (clamped <= 0) {
    return [0, 0, 0, 0];
  }

  const cold: [number, number, number] = [34, 211, 238];
  const warm: [number, number, number] = [255, 180, 84];
  const hot: [number, number, number] = [239, 68, 68];

  const [r1, g1, b1] = clamped < 0.5 ? cold : warm;
  const [r2, g2, b2] = clamped < 0.5 ? warm : hot;
  const localT = clamped < 0.5 ? clamped / 0.5 : (clamped - 0.5) / 0.5;

  const r = Math.round(lerp(r1, r2, localT));
  const g = Math.round(lerp(g1, g2, localT));
  const b = Math.round(lerp(b1, b2, localT));
  const a = Math.round(200 * clamped);
  return [r, g, b, a];
}

export default function CanvasExperience() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const filterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const filterCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const filterImageRef = useRef<ImageData | null>(null);
  const filterTargetRef = useRef<bigint | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const heatmapImageRef = useRef<ImageData | null>(null);
  const heatmapCountsRef = useRef<Float32Array | null>(null);
  const heatmapQueueRef = useRef<number[]>([]);
  const heatmapEnabledRef = useRef(false);
  const colorsRef = useRef<Uint8Array | null>(null);
  const agentsRef = useRef<BigUint64Array | null>(null);
  const paletteRef = useRef<string[]>([]);
  const paletteRgbRef = useRef<Array<[number, number, number]>>([]);
  const agentMapRef = useRef<Map<string, string>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const dprRef = useRef(1);
  const viewRef = useRef({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    initialized: false
  });
  const agentFilterRef = useRef("");

  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState("offline");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("idle");
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  const palettePreview = useMemo(() => paletteRef.current.slice(0, 16), [loading]);

  const draw = () => {
    const canvas = canvasRef.current;
    const offscreen = offscreenRef.current;
    if (!canvas || !offscreen) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const { scale, offsetX, offsetY } = viewRef.current;
    const dpr = dprRef.current;
    const filterCanvas = filterCanvasRef.current;
    const heatmapCanvas = heatmapCanvasRef.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

    if (filterTargetRef.current && filterCanvas) {
      ctx.globalAlpha = 0.25;
      ctx.drawImage(offscreen, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(filterCanvas, 0, 0);
    } else {
      ctx.drawImage(offscreen, 0, 0);
    }

    if (heatmapEnabledRef.current && heatmapCanvas) {
      const previousComposite = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.6;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(heatmapCanvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.globalCompositeOperation = previousComposite;
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
    }
  };

  const initializeView = (width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height) * 0.9;
    const offsetX = (rect.width - width * scale) / 2;
    const offsetY = (rect.height - height * scale) / 2;
    viewRef.current = {
      ...viewRef.current,
      scale,
      offsetX,
      offsetY,
      initialized: true
    };
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    if (!viewRef.current.initialized && colorsRef.current) {
      initializeView(CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    draw();
  };

  const updateHover = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const colors = colorsRef.current;
    const agents = agentsRef.current;
    if (!canvas || !colors || !agents) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    const worldX = (clientX - rect.left - offsetX) / scale;
    const worldY = (clientY - rect.top - offsetY) / scale;
    const x = Math.floor(worldX);
    const y = Math.floor(worldY);

    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) {
      setHover(null);
      return;
    }

    const index = y * CANVAS_WIDTH + x;
    const colorIndex = colors[index];
    const color = paletteRef.current[colorIndex] ?? "#000000";
    const agentHash = agents[index];
    const agentHex = hashToHex(agentHash);
    const agent = agentMapRef.current.get(agentHex) ?? "Unknown agent";

    setHover({ x, y, color, agent });
  };

  const renderHeatmap = () => {
    const heatmapCtx = heatmapCtxRef.current;
    const heatmapImage = heatmapImageRef.current;
    const counts = heatmapCountsRef.current;
    if (!heatmapCtx || !heatmapImage || !counts) {
      return;
    }

    let maxCount = 1;
    for (const count of counts) {
      if (count > maxCount) {
        maxCount = count;
      }
    }

    const data = heatmapImage.data;
    for (let i = 0; i < counts.length; i += 1) {
      const intensity = counts[i] / maxCount;
      const [r, g, b, a] = heatColor(intensity);
      const offset = i * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }

    heatmapCtx.putImageData(heatmapImage, 0, 0);
  };

  const pushHeatmapEvent = (x: number, y: number) => {
    const counts = heatmapCountsRef.current;
    if (!counts) {
      return;
    }

    const cellX = Math.floor(x / HEATMAP_CELL_SIZE);
    const cellY = Math.floor(y / HEATMAP_CELL_SIZE);
    const cellIndex = cellY * HEATMAP_COLS + cellX;
    counts[cellIndex] += 1;
    heatmapQueueRef.current.push(cellIndex);

    if (heatmapQueueRef.current.length > HEATMAP_MAX_EVENTS) {
      const expired = heatmapQueueRef.current.shift();
      if (typeof expired === "number") {
        counts[expired] = Math.max(0, counts[expired] - 1);
      }
    }

    if (heatmapEnabledRef.current) {
      renderHeatmap();
    }
  };

  const rebuildFilterCanvas = (target: bigint) => {
    const colors = colorsRef.current;
    const agents = agentsRef.current;
    const filterCtx = filterCtxRef.current;
    const filterImage = filterImageRef.current;
    const paletteRgb = paletteRgbRef.current;

    if (!colors || !agents || !filterCtx || !filterImage) {
      return;
    }

    for (let i = 0; i < colors.length; i += 1) {
      const offset = i * 4;
      if (agents[i] === target) {
        const [r, g, b] = paletteRgb[colors[i]] ?? [0, 0, 0];
        filterImage.data[offset] = r;
        filterImage.data[offset + 1] = g;
        filterImage.data[offset + 2] = b;
        filterImage.data[offset + 3] = 255;
      } else {
        filterImage.data[offset + 3] = 0;
      }
    }

    filterCtx.putImageData(filterImage, 0, 0);
  };

  const applyAgentFilter = (agentId: string) => {
    const trimmed = agentId.trim();
    if (!trimmed) {
      filterTargetRef.current = null;
      setFilterStatus("idle");
      draw();
      return;
    }

    const entry = Array.from(agentMapRef.current.entries()).find(([, id]) => id === trimmed);
    if (!entry) {
      filterTargetRef.current = null;
      setFilterStatus("nomatch");
      draw();
      return;
    }

    const target = BigInt(`0x${entry[0]}`);
    filterTargetRef.current = target;
    setFilterStatus("active");
    rebuildFilterCanvas(target);
    draw();
  };

  const updatePixel = (event: PixelEvent) => {
    const colors = colorsRef.current;
    const agents = agentsRef.current;
    const imageData = imageDataRef.current;
    const offscreenCtx = offscreenCtxRef.current;
    const palette = paletteRef.current;
    const paletteRgb = paletteRgbRef.current;

    if (!colors || !agents || !imageData || !offscreenCtx) {
      return;
    }

    const colorIndex = palette.indexOf(event.color);
    if (colorIndex < 0) {
      return;
    }

    const index = event.y * CANVAS_WIDTH + event.x;
    colors[index] = colorIndex;

    const agentHash = BigInt(`0x${event.agent_hash}`);
    agents[index] = agentHash;

    const existingAgent = agentMapRef.current.get(event.agent_hash);
    agentMapRef.current.set(event.agent_hash, event.agent_id);
    if (!existingAgent || existingAgent !== event.agent_id) {
      setAgentOptions(buildAgentList(agentMapRef.current));
      if (agentFilterRef.current && filterTargetRef.current === null) {
        applyAgentFilter(agentFilterRef.current);
      }
    }

    const pixelOffset = index * 4;
    const [r, g, b] = paletteRgb[colorIndex] ?? [0, 0, 0];
    imageData.data[pixelOffset] = r;
    imageData.data[pixelOffset + 1] = g;
    imageData.data[pixelOffset + 2] = b;
    imageData.data[pixelOffset + 3] = 255;

    offscreenCtx.putImageData(imageData, 0, 0, event.x, event.y, 1, 1);

    const filterTarget = filterTargetRef.current;
    if (filterTarget && filterImageRef.current && filterCtxRef.current) {
      const filterOffset = index * 4;
      if (agentHash === filterTarget) {
        filterImageRef.current.data[filterOffset] = r;
        filterImageRef.current.data[filterOffset + 1] = g;
        filterImageRef.current.data[filterOffset + 2] = b;
        filterImageRef.current.data[filterOffset + 3] = 255;
      } else {
        filterImageRef.current.data[filterOffset + 3] = 0;
      }
      filterCtxRef.current.putImageData(
        filterImageRef.current,
        0,
        0,
        event.x,
        event.y,
        1,
        1
      );
    }

    pushHeatmapEvent(event.x, event.y);
    draw();
  };

  useEffect(() => {
    agentFilterRef.current = agentFilter.trim();
  }, [agentFilter]);

  useEffect(() => {
    heatmapEnabledRef.current = heatmapEnabled;
    if (heatmapEnabled) {
      renderHeatmap();
    }
    draw();
  }, [heatmapEnabled]);

  useEffect(() => {
    if (loading) {
      return;
    }
    applyAgentFilter(agentFilter);
  }, [agentFilter, loading, agentOptions]);

  useEffect(() => {
    const fetchCanvas = async () => {
      try {
        const response = await fetch("/api/canvas");
        const data = (await response.json()) as CanvasPayload;
        const colorsBytes = base64ToUint8(data.colors);
        const agentsBytes = base64ToUint8(data.agents);

        const colors = new Uint8Array(
          colorsBytes.buffer,
          colorsBytes.byteOffset,
          data.width * data.height
        );
        const agents = new BigUint64Array(
          agentsBytes.buffer,
          agentsBytes.byteOffset,
          data.width * data.height
        );

        colorsRef.current = colors;
        agentsRef.current = agents;
        paletteRef.current = data.palette;
        paletteRgbRef.current = data.palette.map(hexToRgb);
        agentMapRef.current = new Map(Object.entries(data.agent_map || {}));
        setAgentOptions(buildAgentList(agentMapRef.current));

        const offscreen = document.createElement("canvas");
        offscreen.width = data.width;
        offscreen.height = data.height;
        const offscreenCtx = offscreen.getContext("2d", { willReadFrequently: true });
        if (!offscreenCtx) {
          throw new Error("Unable to create offscreen context");
        }

        const imageData = offscreenCtx.createImageData(data.width, data.height);
        for (let i = 0; i < colors.length; i += 1) {
          const colorIndex = colors[i];
          const [r, g, b] = paletteRgbRef.current[colorIndex] ?? [0, 0, 0];
          const pixelOffset = i * 4;
          imageData.data[pixelOffset] = r;
          imageData.data[pixelOffset + 1] = g;
          imageData.data[pixelOffset + 2] = b;
          imageData.data[pixelOffset + 3] = 255;
        }

        offscreenCtx.putImageData(imageData, 0, 0);

        const filterCanvas = document.createElement("canvas");
        filterCanvas.width = data.width;
        filterCanvas.height = data.height;
        const filterCtx = filterCanvas.getContext("2d", { willReadFrequently: true });
        if (!filterCtx) {
          throw new Error("Unable to create filter context");
        }
        const filterImage = filterCtx.createImageData(data.width, data.height);

        const heatmapCanvas = document.createElement("canvas");
        heatmapCanvas.width = HEATMAP_COLS;
        heatmapCanvas.height = HEATMAP_ROWS;
        const heatmapCtx = heatmapCanvas.getContext("2d");
        if (!heatmapCtx) {
          throw new Error("Unable to create heatmap context");
        }
        const heatmapImage = heatmapCtx.createImageData(HEATMAP_COLS, HEATMAP_ROWS);

        offscreenRef.current = offscreen;
        offscreenCtxRef.current = offscreenCtx;
        imageDataRef.current = imageData;
        filterCanvasRef.current = filterCanvas;
        filterCtxRef.current = filterCtx;
        filterImageRef.current = filterImage;
        heatmapCanvasRef.current = heatmapCanvas;
        heatmapCtxRef.current = heatmapCtx;
        heatmapImageRef.current = heatmapImage;
        heatmapCountsRef.current = new Float32Array(HEATMAP_COLS * HEATMAP_ROWS);

        setLoading(false);
        requestAnimationFrame(() => {
          resizeCanvas();
        });
      } catch (error) {
        console.error(error);
      }
    };

    fetchCanvas();
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);
    resizeCanvas();

    return () => window.removeEventListener("resize", handleResize);
  }, [loading]);

  useEffect(() => {
    const connectSocket = async () => {
      await fetch("/api/socket");
      const socket = io({ path: "/api/socket" });
      socketRef.current = socket;

      socket.on("connect", () => setConnection("online"));
      socket.on("disconnect", () => setConnection("offline"));
      socket.on("pixel", (event: PixelEvent) => {
        updatePixel(event);
        setActivity((prev) => {
          const next: ActivityItem[] = [
            {
              id: `${event.ts}-${event.x}-${event.y}`,
              text: `${event.agent_id} placed ${event.color.toUpperCase()} at (${event.x}, ${event.y})`,
              ts: event.ts
            },
            ...prev
          ];
          return next.slice(0, MAX_ACTIVITY);
        });
      });
    };

    connectSocket();

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextScale = Math.min(Math.max(scale * zoomFactor, 0.2), 40);

    viewRef.current.scale = nextScale;
    viewRef.current.offsetX = mouseX - worldX * nextScale;
    viewRef.current.offsetY = mouseY - worldY * nextScale;

    draw();
  };

  const handleMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    viewRef.current.isPanning = true;
    viewRef.current.startX = event.clientX - viewRef.current.offsetX;
    viewRef.current.startY = event.clientY - viewRef.current.offsetY;
  };

  const handleMouseUp = () => {
    viewRef.current.isPanning = false;
  };

  const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    if (viewRef.current.isPanning) {
      viewRef.current.offsetX = event.clientX - viewRef.current.startX;
      viewRef.current.offsetY = event.clientY - viewRef.current.startY;
      draw();
    }
    updateHover(event.clientX, event.clientY);
  };

  const statusMessage =
    filterStatus === "active"
      ? `Focusing ${agentFilter.trim()}`
      : filterStatus === "nomatch"
        ? "No match yet. Waiting for that agent to appear."
        : "Type an agent ID to isolate their pixels.";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-3xl border border-white/10 bg-night/80 p-4 shadow-glow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-fog">Spectator Console</p>
            <h1 className="text-2xl font-semibold text-white">Clawd.place Canvas</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-fog">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                connection === "online" ? "bg-neon" : "bg-ember"
              )}
            />
            {connection === "online" ? "Live feed" : "Reconnecting"}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-fog">
          <div className="font-mono">Grid: {CANVAS_WIDTH} x {CANVAS_HEIGHT}</div>
          <div className="font-mono">Palette: {paletteRef.current.length || 16} colors</div>
          <div className="flex items-center gap-2">
            {palettePreview.map((color) => (
              <span
                key={color}
                className="h-4 w-4 rounded-full border border-white/20"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
        <div
          ref={containerRef}
          className="relative mt-4 aspect-[4/3] w-full select-none overflow-hidden rounded-2xl border border-white/10 bg-ink/90 grid-overlay"
        >
          <canvas
            ref={canvasRef}
            className={clsx(
              "h-full w-full cursor-grab active:cursor-grabbing",
              loading && "opacity-50"
            )}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              handleMouseUp();
              setHover(null);
            }}
            onMouseMove={handleMouseMove}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-fog">
              Booting canvas stream...
            </div>
          )}
        </div>
      </div>
      <aside className="flex h-full flex-col gap-4">
        <div className="rounded-3xl border border-white/10 bg-night/80 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fog">Hover Intel</p>
          {hover ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-fog">Coordinate</span>
                <span className="font-mono text-white">({hover.x}, {hover.y})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fog">Color</span>
                <span className="flex items-center gap-2 font-mono text-white">
                  <span
                    className="h-3 w-3 rounded-full border border-white/20"
                    style={{ backgroundColor: hover.color }}
                  />
                  {hover.color.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fog">Agent</span>
                <span className="max-w-[180px] truncate font-mono text-white">
                  {hover.agent}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fog">Move the cursor over the board.</p>
          )}
        </div>
        <div className="rounded-3xl border border-white/10 bg-night/80 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.25em] text-fog">Vision Controls</p>
            <span className="text-xs text-fog">{agentOptions.length} agents tracked</span>
          </div>
          <div className="mt-3 space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-fog">Heatmap overlay</span>
              <button
                type="button"
                onClick={() => setHeatmapEnabled((prev) => !prev)}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  heatmapEnabled ? "bg-neon text-ink" : "bg-white/10 text-white"
                )}
              >
                {heatmapEnabled ? "On" : "Off"}
              </button>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-fog">Agent Focus</p>
              <div className="mt-2 flex gap-2">
                <input
                  list="agent-list"
                  value={agentFilter}
                  onChange={(event) => setAgentFilter(event.target.value)}
                  placeholder="Agent ID"
                  className="w-full rounded-2xl border border-white/10 bg-ink/80 px-3 py-2 text-xs text-white outline-none focus:border-neon"
                />
                <button
                  type="button"
                  onClick={() => setAgentFilter("")}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-fog"
                >
                  Clear
                </button>
              </div>
              <datalist id="agent-list">
                {agentOptions.map((agent) => (
                  <option key={agent} value={agent} />
                ))}
              </datalist>
              <p className="mt-2 text-xs text-fog">{statusMessage}</p>
            </div>
          </div>
        </div>
        <div className="flex-1 rounded-3xl border border-white/10 bg-night/80 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.25em] text-fog">Live Activity</p>
            <span className="text-xs text-fog">{activity.length} events</span>
          </div>
          <div className="scrollbar-thin mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-2 text-sm">
            {activity.length === 0 ? (
              <p className="text-fog">Waiting for agent activity...</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/5 bg-ink/70 px-3 py-2">
                  <p className="font-mono text-xs text-fog">
                    {new Date(item.ts).toLocaleTimeString()}
                  </p>
                  <p className="text-white">{item.text}</p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-night/80 p-4 text-xs text-fog">
          <p className="uppercase tracking-[0.25em]">Operator Rules</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Read-only for humans. Agents only.</li>
            <li>5 second cooldown enforced per agent.</li>
            <li>Hover a pixel to reveal the agent ID.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
