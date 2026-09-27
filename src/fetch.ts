// `fetch`: one song's audio, written to `<directory>/<name>.<ext>` in place,
// announced (`started`) before its first byte so the booth can play it while
// it grows, and `done` once the whole file is there.
import { youtubeThumbnail } from "./links.ts";
import { type FetchRequest, isFetchable } from "./protocol.ts";
import { log } from "./process.ts";
import {
  artistOf,
  compact,
  durationMs,
  httpsOnly,
  type Json,
  siteOfEntry,
  str,
} from "./tracks.ts";
import {
  describeDownloadedAudio,
  download,
  YtDlpError,
  type YtDlpTools,
} from "./yt_dlp.ts";

/** The app kills `fetch` at 10 minutes; we give up a little before. */
const fetchTimeoutMs = 9 * 60_000 + 50_000;

export interface Started {
  path: string;
  size?: number;
  durationMs?: number;
  title?: string;
  artist?: string;
  thumbnail?: string;
  audio?: string;
}

export type FetchEvent = { started: Started } | { done: { path: string } };

/** `started`'s fields from what yt-dlp printed before the download. */
export function startedFrom(path: string, info: Json): Started {
  const id = str(info["id"]);
  const youtube = siteOfEntry(info) === "youtube" && id?.length === 11;
  return compact({
    path,
    // `filesize` when the site says, else yt-dlp's estimate from bitrate and
    // length. The player only uses it to tell a slow download from the end
    // of the file, and `done` settles it either way.
    size: positiveInt(info["filesize"]) ?? positiveInt(info["filesize_approx"]),
    durationMs: durationMs(info["duration"]),
    title: str(info["track"]) ?? str(info["title"]),
    artist: artistOf(info),
    thumbnail: youtube
      ? youtubeThumbnail(id!)
      : httpsOnly(str(info["thumbnail"])),
    audio: describeDownloadedAudio(info),
  });
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

export async function fetchSong(
  request: FetchRequest,
  tools: YtDlpTools,
  emit: (event: FetchEvent) => void,
): Promise<void> {
  if (!isFetchable(request.source, request.trusted)) {
    throw new YtDlpError("That link can't be played");
  }
  let announced = false;
  const result = await download(tools, request.source, {
    directory: request.directory,
    name: request.name,
    // yt-dlp's generic extractor fetches any page it is given: only for
    // songs this user queued, never for a source another client named.
    knownSitesOnly: !request.trusted,
    deadline: Date.now() + fetchTimeoutMs,
    onStarted: ({ path, info }) => {
      announced = true;
      const started = startedFrom(path, info);
      log(`yt-dlp: downloading ${started.audio}`);
      emit({ started });
    },
  });
  // A file already there from before is reported without a before_dl line.
  if (!announced) emit({ started: startedFrom(result.path, result.info) });
  emit({ done: { path: result.path } });
}
