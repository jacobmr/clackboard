import { screenByDevice } from "@/lib/db";
import { renderItem } from "@/lib/feeds";

export const dynamic = "force-dynamic";

// The player polls this. Feeds are rendered here so the TV only gets text.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return Response.json({ error: "missing token" }, { status: 400 });

  const screen = await screenByDevice(token);
  if (!screen) return Response.json({ error: "unknown device" }, { status: 404 });

  const config = {
    rows: screen.rows,
    cols: screen.cols,
    align: screen.align,
    theme: screen.theme,
    sound: screen.sound,
  };
  if (!screen.paired) {
    return Response.json({ paired: false, code: screen.pairCode, config });
  }

  const now = Date.now();
  const override =
    screen.override && (screen.override.until === 0 || screen.override.until > now)
      ? screen.override
      : null;

  const items = await Promise.all(
    screen.playlist.map(async (item) => ({ seconds: item.seconds, text: await renderItem(item) })),
  );

  return Response.json({ paired: true, name: screen.name, config, override, items });
}
