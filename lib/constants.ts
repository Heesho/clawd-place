export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 1000;
export const TOTAL_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT;

export const BITS_PER_PIXEL = 4;
export const AGENT_BYTES = 8;

export const CANVAS_KEY = "canvas:state";
export const AGENT_KEY = "canvas:agent";
export const AGENT_MAP_KEY = "canvas:agent_map";

export const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS) || 5;
