const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const COOKIE_NAME = "snapshot_session";
const TOKEN_VERSION = "v1";

type SessionPayload = {
  v: typeof TOKEN_VERSION;
  iat: number;
  exp: number;
  nonce: string;
};

function getSessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  }
  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sign(data: string): Promise<string> {
  const secret = getSessionSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verify(data: string, signature: string): Promise<boolean> {
  const expected = await sign(data);
  if (signature.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < signature.length; i += 1) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64Url(bytes);
}

export async function createSessionToken(ttlHours = 24 * 7): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: TOKEN_VERSION,
    iat: issuedAt,
    exp: issuedAt + ttlHours * 60 * 60,
    nonce: randomNonce(),
  };

  const payloadBase64 = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }

  const validSignature = await verify(payloadBase64, signature);
  if (!validSignature) {
    return null;
  }

  try {
    const payloadJson = decoder.decode(base64UrlToBytes(payloadBase64));
    const payload = JSON.parse(payloadJson) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== TOKEN_VERSION || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function cookieMaxAgeSeconds(): number {
  return 60 * 60 * 24 * 7;
}
