import { ownerFor } from "@/lib/auth";
import { deleteScreen, getScreen, updateScreen } from "@/lib/db";
import { parsePatch } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

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
