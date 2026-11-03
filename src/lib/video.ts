// YouTube and Vimeo links, turned into embed URLs the TV player can show.
// Shared by the server (validation) and the browser player.

// hash: the privacy key in unlisted Vimeo links (vimeo.com/123/abc).
export type Video = { provider: "youtube" | "vimeo"; id: string; hash?: string };

export function parseVideo(raw: string): Video | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    const id =
      host === "youtu.be"
        ? parts[0]
        : parts[0] === "watch"
          ? url.searchParams.get("v")
          : ["embed", "shorts", "live", "v"].includes(parts[0])
            ? parts[1]
            : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: "youtube", id } : null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/123456, vimeo.com/channels/x/123456, player.vimeo.com/video/123456
    const at = parts.findIndex((p) => /^\d{6,12}$/.test(p));
    if (at < 0) return null;
    const hash = url.searchParams.get("h") ?? parts[at + 1];
    return { provider: "vimeo", id: parts[at], ...(hash && /^[0-9a-f]{6,20}$/.test(hash) ? { hash } : {}) };
  }

  return null;
}

// Autoplay is only allowed muted until someone has tapped the screen.
export function embedUrl(v: Video, muted: boolean): string {
  const m = muted ? 1 : 0;
  if (v.provider === "youtube") {
    // loop=1 needs playlist=<id> to repeat a single video.
    return (
      `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&mute=${m}&controls=0` +
      `&loop=1&playlist=${v.id}&playsinline=1&rel=0&modestbranding=1`
    );
  }
  const h = v.hash ? `h=${v.hash}&` : "";
  return `https://player.vimeo.com/video/${v.id}?${h}autoplay=1&muted=${m}&loop=1&controls=0&title=0&byline=0&portrait=0&dnt=1`;
}
