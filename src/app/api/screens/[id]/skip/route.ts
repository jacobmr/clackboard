import { ownerFor } from "@/lib/auth";
import { skipScreen } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// Move the TV to the next playlist item (within one poll, about 4 s).
//   POST /api/screens/<id>/skip
export async function POST(req: Request, { params }: Ctx) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await skipScreen(owner, (await params).id))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
