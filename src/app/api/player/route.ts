import { layout } from "@/lib/board";
import { screenByDevice } from "@/lib/db";
import { renderItem } from "@/lib/feeds";

export const dynamic = "force-dynamic";

// The player polls this. Feeds are rendered here so the TV only gets text.
// With ?format=grid each message also comes laid out as rows of cells, for
// players that are not browsers (the Pi Zero W player).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const wantGrid = url.searchParams.get("format") === "grid";
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
  const grid = (text: string, align = screen.align) =>
    wantGrid ? { grid: layout(text, screen.rows, screen.cols, align) } : {};

  if (!screen.paired) {
    const text = `PAIR THIS SCREEN\n{yellow} ${screen.pairCode} {yellow}\n${url.host}/APP`;
    return Response.json({ paired: false, code: screen.pairCode, config, ...grid(text, "center") });
  }

  const now = Date.now();
  const override =
    screen.override && (screen.override.until === 0 || screen.override.until > now)
      ? { ...screen.override, ...grid(screen.override.text) }
      : null;

  const items = await Promise.all(
    screen.playlist.map(async (item) => {
      const text = await renderItem(item, screen);
      return { seconds: item.seconds, text, ...grid(text) };
    }),
  );

  return Response.json({ paired: true, name: screen.name, config, override, items });
}
