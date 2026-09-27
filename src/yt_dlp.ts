// yt-dlp, as the DJ booth uses it: list what a link holds, and download one
// song's audio to the booth's folder, telling the app the file as soon as it
// is known so the song can play while it downloads.
import {
  forEachLine,
  forwardToStderr,
  readAll,
  runToEnd,
  spawnTracked,
  stop,
  TimeoutError,
} from "./process.ts";
import { isObject, type Json } from "./tracks.ts";

export class YtDlpError extends Error {}

/** Where yt-dlp is and the JS runtime it solves YouTube's challenges with. */
export interface YtDlpTools {
  ytDlp: string;
  /** `--js-runtimes` value, e.g. `deno:/path/to/deno`. */
  jsRuntime: string;
}

/**
 * The first yt-dlp with `--js-runtimes`, which YouTube needs now. Linux
 * distributions ship far older ones; the manifest downloads the latest.
 */
export const minYtDlp: [number, number, number] = [2025, 11, 12];

export function isRecentYtDlp(version: string): boolean {
  const match = /(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(version);
  if (match === null) return false;
  const v = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i] !== minYtDlp[i]) return v[i] > minYtDlp[i];
  }
  return true;
}

/** yt-dlp's own error line, without the noise around it. */
export function errorFromOutput(stderr: string, fallback: string): YtDlpError {
  const lines: string[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (line.startsWith("ERROR:")) {
      lines.push(line.substring(6).trim());
    } else if (line.includes(": error: ")) {
      // Its command line parser: an option this yt-dlp doesn't know.
      lines.push(line.substring(line.indexOf(": error: ") + 9).trim());
    }
  }
  let message = lines.length === 0 ? fallback : lines[lines.length - 1];
  // "[youtube] dQw4w9WgXcQ: Video unavailable" -> "Video unavailable"
  message = message.replace(/^\[[^\]]+\]\s*[^:]*:\s*/, "");
  return new YtDlpError(message);
}

/**
 * What a download's audio is, from the fields yt-dlp printed:
 * `mp4a.40.2, 130 kbps, 44.1 kHz, stereo (format 140)`. Unknown parts are
 * left out rather than guessed. Goes in `started.audio`, for the app's log,
 * so a song that sounds thin can be told apart from one that is.
 */
export function describeDownloadedAudio(info: Json): string {
  const parts: string[] = [];
  const codec = info["acodec"];
  if (typeof codec === "string" && codec !== "" && codec !== "none") {
    parts.push(codec);
  }
  const abr = info["abr"];
  if (typeof abr === "number" && abr > 0) parts.push(`${Math.round(abr)} kbps`);
  const asr = info["asr"];
  if (typeof asr === "number" && asr > 0) parts.push(`${asr / 1000} kHz`);
  const channels = info["audio_channels"];
  if (typeof channels === "number") {
    const n = Math.round(channels);
    parts.push(n === 1 ? "mono" : n === 2 ? "stereo" : `${n} channels`);
  }
  const format = info["format_id"];
  const described = parts.length === 0
    ? "audio of an unreported kind"
    : parts.join(", ");
  return typeof format === "string" && format !== ""
    ? `${described} (format ${format})`
    : described;
}

/**
 * Lowest bitrate at which an Opus stream is taken. Two reasons, and they
 * agree: below it YouTube's AAC is the better of the two, and libopus only
 * settles on CELT (the one mode the booth's Opus decoder plays well) once
 * it has bits to spare.
 */
export const minOpusKbps = 96;

/**
 * Audio formats the booth's player reads (Opus in WebM or Ogg, AAC in MP4,
 * MP3, Vorbis, FLAC) over plain HTTP: HLS from YouTube comes in MPEG-TS,
 * which it doesn't read. MP3 is the exception, SoundCloud's HLS MP3
 * segments join into a valid file. The last resort is a small video with
 * AAC audio, never a big HLS one.
 *
 * Opus comes first where there is enough of it: YouTube's itag 251 is about
 * the same bitrate as its AAC (itag 140) and keeps roughly 4 kHz more
 * treble.
 */
export const formatSelector = [
  `ba[acodec=opus][abr>=${minOpusKbps}][protocol^=http][ext=webm]`,
  `ba[acodec=opus][abr>=${minOpusKbps}][protocol^=http][ext=opus]`,
  "ba[acodec^=mp4a][protocol^=http]",
  "ba[acodec=mp3]",
  "ba[ext=m4a][protocol^=http]",
  "ba[ext=mp3]",
  "ba[acodec=vorbis][protocol^=http]",
  "ba[acodec=flac][protocol^=http]",
  "b[ext=mp4][protocol^=http][height<=480]",
  "ba[protocol^=http]",
].join("/");

const fields = "title,track,uploader,channel,artist,artists,creator,duration," +
  "thumbnail,id,extractor_key," +
  // What the audio actually is: see describeDownloadedAudio.
  "format_id,acodec,abr,asr,audio_channels";
export const startMark = "djsource-start ";
export const doneMark = "djsource-done ";

/** YouTube now and then refuses a download (HTTP 403) that works when asked again. */
const attempts = 2;

function common(tools: YtDlpTools): string[] {
  return ["--ignore-config", "--no-warnings", "--js-runtimes", tools.jsRuntime];
}

export function inspectArgs(
  tools: YtDlpTools,
  url: string,
  playlist: boolean,
): string[] {
  return [
    ...common(tools),
    "--dump-single-json",
    "--flat-playlist",
    playlist ? "--yes-playlist" : "--no-playlist",
    "--",
    url,
  ];
}

export interface FetchOptions {
  directory: string;
  name: string;
  /**
   * Leaves out yt-dlp's generic extractor, which fetches any page it is
   * given: for songs another client named.
   */
  knownSitesOnly: boolean;
  /** Path separator of this system, for the output name. */
  separator?: string;
}

export function fetchArgs(
  tools: YtDlpTools,
  source: string,
  options: FetchOptions,
): string[] {
  const separator = options.separator ??
    (Deno.build.os === "windows" ? "\\" : "/");
  const directory = options.directory.replace(/[\\/]+$/, "");
  return [
    ...common(tools),
    ...(options.knownSitesOnly ? ["--use-extractors", "default,-generic"] : []),
    "--no-playlist",
    "--no-progress",
    "--no-mtime",
    // Written in place, so it can be played while it grows. A cut short one
    // is never taken for a song: the app only keeps a download that ended
    // with `done`.
    "--no-part",
    // Fixups rewrite the file once it is done, under whoever is reading it;
    // the player reads fragmented MP4 as it is.
    "--fixup",
    "never",
    // --print alone would only simulate.
    "--no-simulate",
    "-f",
    formatSelector,
    // Within whichever alternative of formatSelector matches, the
    // loudest-in-bits one. yt-dlp's own order weighs `quality`, `channels`
    // and codec before the bitrate, so a site offering the same codec twice
    // could otherwise hand us the smaller file.
    "--format-sort",
    "abr,asr",
    "-o",
    // `%` is template syntax in yt-dlp's output name.
    `${directory.replaceAll("%", "%%")}${separator}` +
    `${options.name.replaceAll("%", "%%")}.%(ext)s`,
    "--print",
    `before_dl:${startMark}%(.{filename,filesize,${fields}})j`,
    "--print",
    `after_move:${doneMark}%(.{filepath,${fields}})j`,
    "--",
    source,
  ];
}

/** What `url` holds, without downloading (a playlist is only listed). */
export async function inspect(
  tools: YtDlpTools,
  url: string,
  playlist: boolean,
  timeoutMs: number,
): Promise<Json> {
  let result;
  try {
    result = await runToEnd(
      tools.ytDlp,
      inspectArgs(tools, url, playlist),
      timeoutMs,
    );
  } catch (e) {
    throw await explainFailure(tools, e);
  }
  const json = lastJsonObject(result.stdout);
  if (json === null) {
    throw await explainFailure(
      tools,
      errorFromOutput(result.stderr, `Couldn't read ${url}`),
    );
  }
  return json;
}

/** A song's file and what yt-dlp said about it. */
export interface Download {
  path: string;
  info: Json;
}

/**
 * Downloads `source`'s audio as `<directory>/<name>.<ext>`, calling
 * `onStarted` with the file before its first byte so it can be read as it
 * arrives. Resolves once the whole file is on disk.
 */
export async function download(
  tools: YtDlpTools,
  source: string,
  options: FetchOptions & {
    deadline: number;
    onStarted: (download: Download) => void;
  },
): Promise<Download> {
  let started: Download | undefined;

  /** One run of yt-dlp: its final report, or null and why not. */
  const run = async (): Promise<[Json | null, string]> => {
    let child: Deno.ChildProcess;
    try {
      child = spawnTracked(tools.ytDlp, fetchArgs(tools, source, options));
    } catch (e) {
      throw await explainFailure(tools, e);
    }
    let done: Json | null = null;
    const out = forEachLine(child.stdout, (line) => {
      if (line.startsWith(startMark)) {
        const info = jsonObject(line.substring(startMark.length));
        const path = info?.["filename"];
        if (
          info !== null && typeof path === "string" && started === undefined
        ) {
          started = { path, info };
          options.onStarted(started);
        }
      } else if (line.startsWith(doneMark)) {
        done = jsonObject(line.substring(doneMark.length)) ?? done;
      }
    });
    const err = readAll(child.stderr, forwardToStderr);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        stop(child);
        reject(new YtDlpError("The download took too long"));
      }, Math.max(0, options.deadline - Date.now()));
    });
    let stderr: string;
    try {
      [, stderr] = await Promise.race([
        Promise.all([out, err, child.status]),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
    const report = done as Json | null;
    const path = report?.["filepath"];
    const ok = typeof path === "string" && await exists(path);
    return [ok ? report : null, stderr];
  };

  for (let attempt = 1;; attempt++) {
    const [info, err] = await run();
    if (info !== null) {
      return { path: info["filepath"] as string, info };
    }
    // Again, unless some of the song got written: a player may be reading
    // it.
    const path = (started as Download | undefined)?.path;
    const size = path === undefined ? null : await sizeOf(path);
    if (attempt >= attempts || (size !== null && size > 0)) {
      throw await explainFailure(
        tools,
        errorFromOutput(err, "Couldn't download the song"),
      );
    }
    // yt-dlp would take an empty file for a finished download.
    if (path !== undefined && size !== null) {
      await Deno.remove(path).catch(() => {});
    }
  }
}

/**
 * A failure in words a DJ can act on: a missing yt-dlp, or one too old for
 * the options used here, says so.
 */
async function explainFailure(
  tools: YtDlpTools,
  error: unknown,
): Promise<Error> {
  if (error instanceof Deno.errors.NotFound) {
    return new YtDlpError(
      `yt-dlp is missing (${tools.ytDlp}); install the extension again`,
    );
  }
  if (error instanceof TimeoutError) {
    return new YtDlpError("yt-dlp took too long");
  }
  if (!(error instanceof Error)) return new YtDlpError(String(error));
  if (/no such option/i.test(error.message)) {
    try {
      const version = (await runToEnd(tools.ytDlp, ["--version"], 10_000))
        .stdout.trim();
      if (!isRecentYtDlp(version)) {
        return new YtDlpError(
          `yt-dlp ${version} is too old, ${minYtDlp.join(".")} or newer is ` +
            "needed; install the extension again",
        );
      }
    } catch {
      // Keep the original message.
    }
  }
  return error;
}

async function exists(path: string): Promise<boolean> {
  return (await sizeOf(path)) !== null;
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await Deno.stat(path)).size;
  } catch {
    return null;
  }
}

export function jsonObject(text: string): Json | null {
  try {
    const json = JSON.parse(text.trim());
    return isObject(json) ? json : null;
  } catch {
    return null;
  }
}

export function lastJsonObject(output: string): Json | null {
  const lines = output.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("{")) continue;
    const json = jsonObject(trimmed);
    if (json !== null) return json;
  }
  return null;
}
