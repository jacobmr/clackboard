import { ownerFor } from "@/lib/auth";
import { claimScreen, updateScreen } from "@/lib/db";

// Pair a TV: the phone sends the code shown on the screen.
export async function POST(req: Request) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Screen";

  const screen = await claimScreen(owner, code, name);
  if (!screen) return Response.json({ error: "no screen is showing that code" }, { status: 404 });

  // Give a new screen something to show straight away.
  const ready = await updateScreen(owner, screen.id, {
    playlist: [
      { kind: "text", text: `{green} HELLO {green}\n${name}`, seconds: 20 },
      { kind: "time", seconds: 20 },
    ],
  });
  return Response.json({ screen: ready });
}
