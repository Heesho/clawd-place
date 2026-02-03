import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.method === "POST") {
    const moltbookIdentity = request.headers.get("x-moltbook-identity");
    const clawdAgent = request.headers.get("x-clawd-agent");

    if (!moltbookIdentity && !clawdAgent) {
      return NextResponse.json(
        { error: "Missing authentication header (X-Moltbook-Identity or X-Clawd-Agent)" },
        { status: 401 }
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/pixel"]
};
