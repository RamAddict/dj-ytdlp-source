// Queue entries (protocol 1 `resolve` tracks) from what yt-dlp says about a
// link, and the small readers of yt-dlp's JSON they share with `fetch`.
import {
  type Link,
  type Site,
  siteOf,
  youtubeThumbnail,
  youtubeVideoId,
} from "./links.ts";

export type Json = Record<string, unknown>;

/** A `resolve` answer's track, as protocol 1 names its fields. */
export interface Track {
  source: string;
  title: string;
  artist?: string;
  durationMs?: number;
  thumbnail?: string;
  link?: string;
  label?: string;
}

/** Protocol 1: `source` travels to everyone in the call, at most 900 chars. */
export const maxSourceLength = 900;

/** What the song's chip in the queue says (at most 16 characters). */
export function labelOf(site: Site): string | undefined {
  switch (site) {
    case "youtube":
      return "YouTube";
    case "soundcloud":
      return "SoundCloud";
    case "spotify":
      return "Spotify";
    default:
      return undefined;
  }
}

/** Queue entries from yt-dlp's `--dump-single-json --flat-playlist`. */
export function tracksFromYtDlp(json: Json, link: Link): Track[] {
  const entries: Json[] = json["_type"] === "playlist" &&
      Array.isArray(json["entries"])
    ? (json["entries"] as unknown[]).filter(isObject)
    : [json];
  const tracks: Track[] = [];
  for (const entry of entries) {
    const url = str(entry["webpage_url"]) ?? str(entry["original_url"]) ??
      str(entry["url"]);
    if (url === undefined) continue;
    const site = siteOfEntry(entry, link);
    const id = str(entry["id"]);
    const youtubeId = site === "youtube" && id !== undefined && id.length === 11
      ? id
      : youtubeVideoId(url);
    const source = youtubeId !== null
      ? `https://www.youtube.com/watch?v=${youtubeId}`
      : url;
    if (source.length > maxSourceLength) continue;
    tracks.push(compact({
      source,
      title: str(entry["track"]) ?? str(entry["title"]) ?? titleFromUrl(url),
      artist: artistOf(entry),
      durationMs: durationMs(entry["duration"]),
      thumbnail: youtubeId !== null
        ? youtubeThumbnail(youtubeId)
        : thumbnailOf(entry),
      label: labelOf(site),
    }));
  }
  return tracks;
}

/** Which site an entry came from: yt-dlp's extractor says best. */
export function siteOfEntry(entry: Json, link?: Link): Site {
  const extractor = (str(entry["ie_key"]) ?? str(entry["extractor_key"]) ?? "")
    .toLowerCase();
  if (extractor.startsWith("youtube")) return "youtube";
  if (extractor.startsWith("soundcloud")) return "soundcloud";
  if (link === undefined) return "other";
  const site = siteOf(link.type);
  return site === "spotify" ? "other" : site;
}

export function artistOf(entry: Json): string | undefined {
  const artists = entry["artists"];
  if (Array.isArray(artists)) {
    const names = artists.filter((a): a is string =>
      typeof a === "string" && a.trim() !== ""
    );
    if (names.length > 0) return names.join(", ");
  }
  const name = str(entry["artist"]) ?? str(entry["creator"]) ??
    str(entry["uploader"]) ?? str(entry["channel"]);
  // YouTube's auto-generated music channels: "Artist - Topic".
  return name?.replace(/\s+-\s+Topic$/, "");
}

export function thumbnailOf(entry: Json): string | undefined {
  const single = str(entry["thumbnail"]);
  if (single !== undefined) return httpsOnly(single);
  const thumbnails = entry["thumbnails"];
  if (Array.isArray(thumbnails) && thumbnails.length > 0) {
    const last = thumbnails[thumbnails.length - 1];
    if (isObject(last)) return httpsOnly(str(last["url"]));
  }
  return undefined;
}

/** Protocol 1 takes `https://` thumbnails only. */
export function httpsOnly(url: string | undefined): string | undefined {
  return url !== undefined && url.startsWith("https://") ? url : undefined;
}

/** "https://soundcloud.com/artist/some-track-name" -> "Some track name". */
export function titleFromUrl(url: string): string {
  let slug: string;
  try {
    const segments = new URL(url).pathname.split("/").filter((s) => s !== "");
    // Nothing to make words of: the link itself.
    if (segments.length === 0) return url;
    slug = decodeURIComponent(segments.at(-1)!);
  } catch {
    // Not a URL, or bad percent-encoding.
    return url;
  }
  const words = slug.replace(/[-_]+/g, " ").trim();
  if (words === "") return url;
  return words[0].toUpperCase() + words.substring(1);
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function durationMs(seconds: unknown): number | undefined {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : undefined;
}

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Leaves out the fields that are undefined, so the JSON stays small. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}
