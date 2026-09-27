// Spotify's audio is DRM protected, so a Spotify link is read for its songs'
// titles and artists (from the public embed page, no API key) and each song
// is played from YouTube, found by a search when it is fetched.
import type { Link } from "./links.ts";
import { compact, isObject, maxSourceLength, type Track } from "./tracks.ts";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36";

export class ResolveError extends Error {}

/**
 * Where a Spotify short share link (spotify.link, *.app.link) leads: the
 * real `open.spotify.com` page, which is what can be read. Null when it
 * leads nowhere readable within a few hops.
 */
export async function followSpotifyRedirects(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetcher(current, {
      redirect: "manual",
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return current.toString();
    }
    current = new URL(location, current);
    if (current.hostname === "open.spotify.com") return current.toString();
  }
  return null;
}

/**
 * A Spotify track, album or playlist from its public embed page, which
 * carries a track's title, artists and length, or the first 50 or so tracks
 * of an album or playlist.
 */
export async function spotifyTracks(
  link: Link,
  fetcher: typeof fetch = fetch,
): Promise<Track[]> {
  const type = link.url.split("/").at(-2);
  const response = await fetcher(
    `https://open.spotify.com/embed/${type}/${link.id}`,
    {
      headers: { "User-Agent": userAgent, "Accept-Language": "en" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new ResolveError(`Spotify answered ${response.status}`);
  }
  const tracks = parseSpotifyEmbed(await response.text(), link);
  if (tracks.length === 0) {
    throw new ResolveError("No songs found on that Spotify page");
  }
  return tracks;
}

/** Tracks in an embed page's `__NEXT_DATA__`. */
export function parseSpotifyEmbed(html: string, link: Link): Track[] {
  const match =
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
      .exec(html);
  if (match === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const entity = path(data, ["props", "pageProps", "state", "data", "entity"]);
  if (!isObject(entity)) return [];

  const cover = coverOf(entity);
  if (entity["type"] === "track") {
    const title = entity["name"] ?? entity["title"];
    if (typeof title !== "string") return [];
    const artists = Array.isArray(entity["artists"])
      ? (entity["artists"] as unknown[])
        .filter(isObject)
        .map((a) => a["name"])
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .join(", ")
      : undefined;
    return [track(title, artists, entity["duration"], link.url, cover)];
  }

  const list = entity["trackList"];
  if (!Array.isArray(list)) return [];
  // An album's tracks share its cover; a playlist's don't, and the page has
  // no per-track art.
  const shared = entity["type"] === "album" ? cover : undefined;
  const tracks: Track[] = [];
  for (const item of list) {
    if (!isObject(item) || typeof item["title"] !== "string") continue;
    tracks.push(track(
      item["title"],
      typeof item["subtitle"] === "string" ? item["subtitle"] : undefined,
      item["duration"],
      trackUrl(item["uri"]) ?? link.url,
      shared,
    ));
  }
  return tracks;
}

/** The YouTube search a Spotify song is played from. */
export function searchFor(title: string, artist: string | undefined): string {
  const query = `ytsearch1:${
    artist !== undefined ? `${artist} - ` : ""
  }${title}`;
  return query.length > maxSourceLength
    ? query.substring(0, maxSourceLength)
    : query;
}

function track(
  title: string,
  artists: string | undefined,
  duration: unknown,
  link: string,
  thumbnail: string | undefined,
): Track {
  const artist = artists?.trim() ? artists.trim() : undefined;
  return compact({
    // Played from YouTube: the best match for "artist - title". `link` keeps
    // the Spotify title and artist on the queue entry, rather than whatever
    // the YouTube video is called.
    source: searchFor(title, artist),
    title,
    artist,
    durationMs: typeof duration === "number" && duration > 0
      ? Math.trunc(duration)
      : undefined,
    thumbnail: thumbnail?.startsWith("https://") ? thumbnail : undefined,
    link,
    label: "Spotify",
  });
}

function trackUrl(uri: unknown): string | undefined {
  if (typeof uri !== "string" || !uri.startsWith("spotify:track:")) {
    return undefined;
  }
  return `https://open.spotify.com/track/${uri.substring(14)}`;
}

function coverOf(entity: Record<string, unknown>): string | undefined {
  const sources = path(entity, ["coverArt", "sources"]) ??
    path(entity, ["visualIdentity", "image"]);
  if (!Array.isArray(sources)) return undefined;
  // The one closest to what the booth shows (~300 px).
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const source of sources) {
    if (!isObject(source)) continue;
    const url = source["url"];
    const width = typeof source["width"] === "number" ? source["width"] : 0;
    const distance = Math.abs(width - 300);
    if (typeof url === "string" && distance < bestDistance) {
      best = url;
      bestDistance = distance;
    }
  }
  return best;
}

function path(json: unknown, keys: string[]): unknown {
  let node = json;
  for (const key of keys) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return node;
}
