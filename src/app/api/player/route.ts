import { layout } from "@/lib/board";
import { screenByDevice } from "@/lib/db";
import { renderItem } from "@/lib/feeds";
import { parseVideo } from "@/lib/video";

export const dynamic = "force-dynamic";

// The player polls this. Feeds are rendered here so the TV only gets text.
// With ?format=grid each message also comes laid out as rows of cells, for
// players that are not browsers (the Pi Zero W player).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const wantGrid = url.searchParams.get("format") === "grid";
  if (!token) return Response.json({ error: "missing token" }, { status: 400 });

  // ?boot=1 on a player's first poll: a paired screen then shows a sign-in code.
  const screen = await screenByDevice(token, url.searchParams.get("boot") === "1");
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
  const signin = screen.login
    ? `TO SIGN IN, GO TO\n${url.host}/APP\nAND ENTER\n{yellow} ${screen.login.code} {yellow}`
    : null;
  const override = signin
    ? { text: signin, until: screen.login!.until, ...grid(signin, "center") }
    : screen.override && (screen.override.until === 0 || screen.override.until > now)
      ? { ...screen.override, ...grid(screen.override.text) }
      : null;

  // Grid players (the Pi Zero W) have no browser to play video, so they get
  // the playlist without video items.
  const playlist = wantGrid ? screen.playlist.filter((i) => i.kind !== "video") : screen.playlist;
  const items = await Promise.all(
    playlist.map(async (item) => {
      if (item.kind === "video") {
        const video = parseVideo(item.url);
        if (video) return { seconds: item.seconds, text: "", video };
      }
      const text = await renderItem(item, screen);
      return { seconds: item.seconds, text, ...grid(text) };
    }),
  );

  return Response.json({ paired: true, name: screen.name, config, override, items, signinCode: screen.login?.code ?? null });
}
