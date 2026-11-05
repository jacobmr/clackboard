import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DEFAULT_OWNER } from "./db";

// No passwords: the TV is the key.
//   - Pairing a new TV with its code creates an account on that phone (or
//     adds the TV to the account the phone is already signed in to).
//   - A paired TV shows a sign-in code for 2 minutes after it boots; typing
//     it signs a phone in to that TV's account.
// Either way the phone gets a signed session cookie that lasts a year.
//   API_TOKEN       - Bearer token for scripts, Home Assistant, curl; it acts
//                     as DEFAULT_OWNER, the account the first screens were made in
//   SESSION_SECRET  - signs the session cookie

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

export async function startSession(owner: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, `${owner}.${sign(owner)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
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
