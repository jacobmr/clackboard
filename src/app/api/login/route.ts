import { cookies } from "next/headers";
import { SESSION_COOKIE, checkPassword, sessionValue } from "@/lib/auth";

// Failed attempts per client, per server instance. Enough to stop a script
// from guessing; not a substitute for a strong ADMIN_PASSWORD.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { count: number; since: number }>();

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export async function POST(req: Request) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = fails.get(key);
  if (entry && now - entry.since > WINDOW_MS) fails.delete(key);
  if ((fails.get(key)?.count ?? 0) >= MAX_FAILS) {
    return Response.json({ error: "too many attempts, try again later" }, { status: 429 });
  }

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !checkPassword(password)) {
    const e = fails.get(key) ?? { count: 0, since: now };
    e.count += 1;
    fails.set(key, e);
    return Response.json({ error: "wrong password" }, { status: 401 });
  }

  fails.delete(key);
  (await cookies()).set(SESSION_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ ok: true });
}
