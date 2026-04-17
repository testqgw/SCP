import type { NextRequest } from "next/server";

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
