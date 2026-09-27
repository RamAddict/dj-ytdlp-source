// Recognises the links this extension takes: YouTube, SoundCloud and
// Spotify, normalised, and which of them are collections (playlists, sets,
// albums) that yt-dlp must list with `--yes-playlist`. Pure string work.

export type LinkType =
  | "youtubeVideo"
  | "youtubePlaylist"
  | "soundcloudTrack"
  | "soundcloudSet"
  | "spotifyTrack"
  | "spotifyAlbum"
  | "spotifyPlaylist"
  /** Any other http(s) link: yt-dlp may still know it. */
  | "other";

export type Site = "youtube" | "soundcloud" | "spotify" | "other";

export interface Link {
  type: LinkType;
  /** The link, normalised: `https://`, no tracking parameters. */
  url: string;
  /** Video, track, album or playlist id where the link has one. */
  id?: string;
}

export function siteOf(type: LinkType): Site {
  switch (type) {
    case "youtubeVideo":
    case "youtubePlaylist":
      return "youtube";
    case "soundcloudTrack":
    case "soundcloudSet":
      return "soundcloud";
    case "spotifyTrack":
    case "spotifyAlbum":
    case "spotifyPlaylist":
      return "spotify";
    default:
      return "other";
  }
}

export function isCollection(type: LinkType): boolean {
  return type === "youtubePlaylist" || type === "soundcloudSet" ||
    type === "spotifyAlbum" || type === "spotifyPlaylist";
}

const urlPattern = /https?:\/\/[^\s<>"]+/g;
const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;
const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;

/**
 * Every link in `text` (pasted text can hold several, one per line), in
 * order, without duplicates. Bare `youtube.com/...` style links without a
 * scheme count too.
 */
export function parseAllLinks(text: string): Link[] {
  const found: Link[] = [];
  const seen = new Set<string>();
  const withScheme = text.replace(
    /(^|\s)((?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|soundcloud\.com|open\.spotify\.com|on\.soundcloud\.com)\/)/g,
    (_m, space: string, rest: string) => `${space}https://${rest}`,
  );
  for (const match of withScheme.matchAll(urlPattern)) {
    const link = parseLink(trimPunctuation(match[0]));
    if (link && !seen.has(link.url)) {
      seen.add(link.url);
      found.push(link);
    }
  }
  return found;
}

function trimPunctuation(url: string): string {
  return url.replace(/[).,;!?\]]+$/, "");
}

/** What `input` links to; null when it is not an http(s) link. */
export function parseLink(input: string): Link | null {
  try {
    return parse(input);
  } catch {
    // Malformed percent-encoding in the path, or not a URL at all.
    return null;
  }
}

function parse(input: string): Link | null {
  const text = input.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  const uri = new URL(text);
  if (uri.hostname === "") return null;
  const host = uri.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const segments = uri.pathname.split("/").filter((s) => s !== "").map(
    decodeURIComponent,
  );
  const query = uri.searchParams;

  if (host === "youtu.be" && segments.length > 0) {
    const id = segments[0];
    if (youtubeIdPattern.test(id)) return youtubeVideo(id);
  }

  if (
    host === "youtube.com" || host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    const v = query.get("v");
    const list = query.get("list");
    // A video opened from a playlist plays that video, like a player
    // would. The playlist page itself queues the whole list.
    if (v !== null && youtubeIdPattern.test(v)) return youtubeVideo(v);
    if (
      segments.length > 1 &&
      ["shorts", "live", "embed", "v"].includes(segments[0]) &&
      youtubeIdPattern.test(segments[1])
    ) {
      return youtubeVideo(segments[1]);
    }
    if (list !== null && list !== "") {
      return {
        type: "youtubePlaylist",
        url: `https://www.youtube.com/playlist?list=${
          encodeURIComponent(list)
        }`,
        id: list,
      };
    }
    return null;
  }

  if (host === "soundcloud.com" || host === "on.soundcloud.com") {
    if (host === "on.soundcloud.com") {
      // Short share links redirect; yt-dlp follows them.
      return { type: "soundcloudTrack", url: clean(uri) };
    }
    if (segments.length >= 3 && segments[1] === "sets") {
      return {
        type: "soundcloudSet",
        url: `https://soundcloud.com/${segments[0]}/sets/${segments[2]}`,
      };
    }
    if (
      segments.length >= 2 &&
      !["you", "discover", "stream", "search", "charts"].includes(segments[0])
    ) {
      return {
        type: "soundcloudTrack",
        url: `https://soundcloud.com/${segments[0]}/${segments[1]}`,
      };
    }
    return null;
  }

  if (host === "open.spotify.com") {
    if (segments.length === 0) return null;
    // Localised links: /intl-de/track/...
    const parts = segments[0].startsWith("intl-")
      ? segments.slice(1)
      : segments;
    if (parts.length >= 2) {
      const id = parts[1];
      const type: LinkType | null = parts[0] === "track"
        ? "spotifyTrack"
        : parts[0] === "album"
        ? "spotifyAlbum"
        : parts[0] === "playlist"
        ? "spotifyPlaylist"
        : null;
      if (type !== null && spotifyIdPattern.test(id)) {
        return { type, url: `https://open.spotify.com/${parts[0]}/${id}`, id };
      }
    }
    return null;
  }

  return { type: "other", url: clean(uri) };
}

function youtubeVideo(id: string): Link {
  return {
    type: "youtubeVideo",
    url: `https://www.youtube.com/watch?v=${id}`,
    id,
  };
}

/** `https://`, without `utm_*` and `si` tracking parameters. */
function clean(uri: URL): string {
  const out = new URL(uri.toString());
  out.protocol = "https:";
  for (const key of [...out.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "si") out.searchParams.delete(key);
  }
  if ([...out.searchParams.keys()].length === 0) out.search = "";
  return out.toString();
}

/** Spotify's short share links (from the phone app), which redirect. */
export function isSpotifyShortLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "spotify.link" || host.endsWith(".app.link");
  } catch {
    return false;
  }
}

/** YouTube thumbnail of a video id, without asking YouTube. */
export function youtubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** The YouTube video id in `url`, if it is a YouTube video link. */
export function youtubeVideoId(url: string): string | null {
  const link = parseLink(url);
  return link?.type === "youtubeVideo" ? link.id ?? null : null;
}
