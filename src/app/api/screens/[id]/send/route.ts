import { ownerFor } from "@/lib/auth";
import { listScreens, updateScreen } from "@/lib/db";
import { parseSend } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// Show a message now, ahead of the playlist.
//   POST /api/screens/<id>/send   {"text": "DINNER AT 7", "seconds": 300}
//   POST /api/screens/all/send    sends to every screen
// "seconds": 0 keeps it up until cleared with DELETE.
export async function POST(req: Request, { params }: Ctx) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });

  const msg = parseSend(await req.json().catch(() => ({})));
  if (!msg) return Response.json({ error: "text is required" }, { status: 400 });

  const override = { text: msg.text, until: msg.seconds === 0 ? 0 : Date.now() + msg.seconds * 1000 };
  const ids = await targetIds(owner, (await params).id);
  const sent = (await Promise.all(ids.map((id) => updateScreen(owner, id, { override })))).filter(Boolean);
  if (sent.length === 0) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ sent: sent.length });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ids = await targetIds(owner, (await params).id);
  await Promise.all(ids.map((id) => updateScreen(owner, id, { override: null })));
  return Response.json({ cleared: ids.length });
}

async function targetIds(owner: string, id: string): Promise<string[]> {
  return id === "all" ? (await listScreens(owner)).map((s) => s.id) : [id];
}
