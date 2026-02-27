import { NextResponse } from "next/server";
import { COOKIE_NAME, cookieMaxAgeSeconds, createSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type UnlockRequestBody = {
  passcode?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  const configuredPasscode = process.env.APP_PASSCODE;
  if (!configuredPasscode) {
    return NextResponse.json({ error: "APP_PASSCODE is not configured." }, { status: 500 });
  }

  let body: UnlockRequestBody;
  try {
    body = (await request.json()) as UnlockRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.passcode || body.passcode !== configuredPasscode) {
    return NextResponse.json({ error: "Invalid passcode." }, { status: 401 });
  }

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAgeSeconds(),
  });

  return response;
}
