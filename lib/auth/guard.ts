import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

export async function isSessionAuthenticated(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return false;
  }
  const payload = await verifySessionToken(token);
  return Boolean(payload);
}

export function isCronAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  const xCronSecret = request.headers.get("x-cron-secret");

  if (xCronSecret && xCronSecret === configuredSecret) {
    return true;
  }

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    return token === configuredSecret;
  }

  return false;
}
