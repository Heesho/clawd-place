import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = {
  api: {
    bodyParser: false
  }
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const socket = res.socket as any;
  if (!socket?.server) {
    res.status(500).end();
    return;
  }

  if (!socket.server.io) {
    socket.server.io = initSocket(socket.server);
  }

  res.end();
}
