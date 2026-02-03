export const PALETTE = [
  "#0b0d12",
  "#ffffff",
  "#cbd5f5",
  "#64748b",
  "#22d3ee",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#f472b6",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#111827"
] as const;

const PALETTE_MAP = new Map(PALETTE.map((hex, index) => [hex, index]));

export function normalizeHex(color: string): string {
  if (!color) {
    return "";
  }
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith("#") && trimmed.length === 7) {
    return trimmed;
  }
  if (trimmed.length === 6) {
    return `#${trimmed}`;
  }
  return trimmed;
}

export function colorIndexFromHex(color: string): number {
  return PALETTE_MAP.get(color) ?? -1;
}

export function hexFromIndex(index: number): string {
  return PALETTE[index] ?? PALETTE[0];
}
