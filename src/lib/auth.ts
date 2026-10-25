import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DEFAULT_OWNER } from "./db";

// Single-owner auth for a self-hosted install:
//   ADMIN_PASSWORD  - typed once on the phone, sets a session cookie
//   API_TOKEN       - Bearer token for scripts, Home Assistant, curl
//   SESSION_SECRET  - signs the session cookie
// Both resolve to DEFAULT_OWNER; accounts can replace this later.

export const SESSION_COOKIE = "cb_session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected) && safeEqual(password, expected!);
}

export function sessionValue(): string {
  return `${DEFAULT_OWNER}.${sign(DEFAULT_OWNER)}`;
}

// Returns the owner for a request, from the session cookie or a Bearer token.
export async function ownerFor(req?: Request): Promise<string | null> {
  const auth = req?.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = process.env.API_TOKEN;
    return token && safeEqual(auth.slice(7), token) ? DEFAULT_OWNER : null;
  }
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const [owner, mac] = value.split(".");
  return owner && mac && safeEqual(mac, sign(owner)) ? owner : null;
}
