import { createDevice } from "@/lib/db";

// A TV that has never been paired registers itself and shows the code.
export async function POST() {
  return Response.json(await createDevice());
}
