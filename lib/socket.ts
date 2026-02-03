import type { Server as HTTPServer } from "http";
import { Server as IOServer } from "socket.io";

const globalForSocket = globalThis as typeof globalThis & {
  _clawdIo?: IOServer;
};

export function initSocket(server: HTTPServer): IOServer {
  if (!globalForSocket._clawdIo) {
    globalForSocket._clawdIo = new IOServer(server, {
      path: "/api/socket",
      cors: {
        origin: "*"
      }
    });
  }
  return globalForSocket._clawdIo;
}

export function getSocket(): IOServer | undefined {
  return globalForSocket._clawdIo;
}
