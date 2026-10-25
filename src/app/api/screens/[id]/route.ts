import { ownerFor } from "@/lib/auth";
import { deleteScreen, getScreen, updateScreen } from "@/lib/db";
import { renderItem } from "@/lib/feeds";
import { parsePatch } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The screen plus its playlist rendered as the TV would show it, for previews.
export async function GET(req: Request, { params }: Ctx) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const screen = await getScreen(owner, (await params).id);
  if (!screen) return Response.json({ error: "not found" }, { status: 404 });
  const rendered = await Promise.all(screen.playlist.map((item) => renderItem(item, screen)));
  return Response.json({ screen, rendered });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const current = await getScreen(owner, id);
  if (!current) return Response.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const screen = await updateScreen(owner, id, parsePatch(body, current));
  return Response.json({ screen });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await deleteScreen(owner, id))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
