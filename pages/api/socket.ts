import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = {
  api: {
    bodyParser: false
  }
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!res.socket?.server) {
    res.status(500).end();
    return;
  }

  if (!(res.socket.server as any).io) {
    (res.socket.server as any).io = initSocket(res.socket.server as any);
  }

  res.end();
}
