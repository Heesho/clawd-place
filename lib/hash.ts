import { createHash } from "crypto";

export function hashAgentId(agentId: string): bigint {
  const hash = createHash("sha256").update(agentId).digest();
  return hash.readBigUInt64BE(0);
}

export function hashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}
