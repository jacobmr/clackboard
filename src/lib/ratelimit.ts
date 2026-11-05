// Failed attempts per client, per server instance. Enough to slow a script
// guessing 6-character codes (32^6, about a billion); not a hard limit across
// instances.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { count: number; since: number }>();

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export function limited(req: Request): boolean {
  const key = clientKey(req);
  const entry = fails.get(key);
  if (entry && Date.now() - entry.since > WINDOW_MS) fails.delete(key);
  return (fails.get(key)?.count ?? 0) >= MAX_FAILS;
}

export function failed(req: Request): void {
  const key = clientKey(req);
  const e = fails.get(key) ?? { count: 0, since: Date.now() };
  e.count += 1;
  fails.set(key, e);
}
