import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.method === "POST") {
    const agentHeader = request.headers.get("x-clawd-agent");
    if (!agentHeader) {
      return NextResponse.json(
        { error: "Missing X-Clawd-Agent header" },
        { status: 401 }
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/pixel"]
};
