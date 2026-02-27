import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

const PUBLIC_PATHS = [
  "/unlock",
  "/api/auth/unlock",
  "/api/health",
];

const INTERNAL_PREFIXES = [
  "/api/internal/refresh/full",
  "/api/internal/refresh/delta",
  "/api/internal/cleanup/lines",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next") || pathname.includes(".");
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isStaticPath(pathname) || isPublicPath(pathname) || isInternalPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isAuthenticated = token ? await verifySessionToken(token) : null;

  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
