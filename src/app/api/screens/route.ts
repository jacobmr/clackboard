import { ownerFor } from "@/lib/auth";
import { listScreens } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = await ownerFor(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ screens: await listScreens(owner) });
}
