// `resolve`: what a pasted link holds.
//
// YouTube and SoundCloud (and anything else yt-dlp knows) are listed with
// yt-dlp. Spotify links are read from Spotify's public embed page and each
// song becomes a YouTube search (see spotify.ts).
import {
  isCollection,
  isSpotifyShortLink,
  type Link,
  parseLink,
  siteOf,
} from "./links.ts";
import {
  followSpotifyRedirects,
  ResolveError,
  spotifyTracks,
} from "./spotify.ts";
import { type Track, tracksFromYtDlp } from "./tracks.ts";
import { inspect, type YtDlpTools } from "./yt_dlp.ts";

export { ResolveError };

/** The app kills `resolve` at 90 seconds; yt-dlp gets a little less. */
const inspectTimeoutMs = 85_000;

export const nothingPlayable = "Nothing playable in that link";

export interface ResolveDeps {
  tools: YtDlpTools;
  fetcher?: typeof fetch;
}

export async function resolve(
  url: string,
  deps: ResolveDeps,
): Promise<Track[]> {
  const link = parseLink(url);
  if (link === null) {
    // A channel page, a SoundCloud feed and the like are links, just not to
    // songs.
    throw new ResolveError(
      /^https?:\/\//i.test(url.trim())
        ? nothingPlayable
        : "That isn't a web link",
    );
  }
  return await resolveLink(link, deps);
}

async function resolveLink(link: Link, deps: ResolveDeps): Promise<Track[]> {
  // Spotify's short share links (from the phone app) redirect to the real
  // page, which is what can be read.
  if (link.type === "other" && isSpotifyShortLink(link.url)) {
    const target = await followSpotifyRedirects(link.url, deps.fetcher);
    const real = target === null ? null : parseLink(target);
    if (real === null || real.type === "other") {
      throw new ResolveError("That Spotify link doesn't lead to a song");
    }
    return await resolveLink(real, deps);
  }
  if (siteOf(link.type) === "spotify") {
    return await spotifyTracks(link, deps.fetcher);
  }
  const json = await inspect(
    deps.tools,
    link.url,
    isCollection(link.type),
    inspectTimeoutMs,
  );
  const tracks = tracksFromYtDlp(json, link);
  if (tracks.length === 0) throw new ResolveError(nothingPlayable);
  return tracks;
}
