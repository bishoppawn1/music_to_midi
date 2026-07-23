import { Innertube } from "youtubei.js/cf-worker";

export const runtime = "edge";

const MAX_DURATION_SECONDS = 10 * 60;
const PAGES_ORIGIN = "https://bishoppawn1.github.io";

function corsHeaders() {
  return {
    "access-control-allow-origin": PAGES_ORIGIN,
    "access-control-expose-headers": "x-video-title, x-video-duration",
    vary: "origin",
  };
}

function youtubeId(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
  if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const parts = url.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || null;
  return null;
}

function problem(error: string, status: number) {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...corsHeaders(),
      },
    },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-origin": PAGES_ORIGIN,
      "access-control-max-age": "86400",
      vary: "origin",
    },
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sourceUrl = requestUrl.searchParams.get("url") || "";
  const videoId = youtubeId(sourceUrl);
  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return problem("Paste a valid YouTube video link.", 400);
  }

  try {
    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId, { client: "ANDROID_VR" });
    const title = info.basic_info.title || "YouTube transcription";
    const duration = info.basic_info.duration || 0;
    if (!info.streaming_data) return problem("YouTube did not provide playable audio for this video.", 422);
    if (duration > MAX_DURATION_SECONDS) {
      return problem("Choose a video that is 10 minutes or shorter.", 413);
    }

    const format = info.chooseFormat({ type: "audio", quality: "bestefficiency", format: "any" });
    const stream = await info.download({
      type: "audio",
      quality: "bestefficiency",
      format: "any",
      client: "ANDROID_VR",
    });

    const headers = new Headers({
      "cache-control": "private, no-store",
      "content-type": format.mime_type || "audio/mp4",
      "x-content-type-options": "nosniff",
      "x-video-title": encodeURIComponent(title).slice(0, 1400),
      "x-video-duration": String(duration),
      ...corsHeaders(),
    });
    if (format.content_length) headers.set("content-length", String(format.content_length));
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    console.error("YouTube audio request failed", error);
    return problem("This video could not be processed right now. Check that it is public and try again.", 502);
  }
}
