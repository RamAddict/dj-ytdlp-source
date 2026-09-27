// yt-dlp's command lines and output readers.
import { deepStrictEqual as eq, equal, ok } from "node:assert/strict";
import {
  describeDownloadedAudio,
  doneMark,
  errorFromOutput,
  fetchArgs,
  formatSelector,
  inspectArgs,
  isRecentYtDlp,
  lastJsonObject,
  startMark,
} from "../src/yt_dlp.ts";

// The booth records what each song was actually downloaded as, so a track
// that sounds thin can be told apart from one that is. yt-dlp prints these
// fields with the file name, before the first byte arrives.
Deno.test("YouTube's best AAC reads back in full", () => {
  // itag 140, what formatSelector picks for a YouTube link without Opus.
  equal(
    describeDownloadedAudio({
      format_id: "140",
      acodec: "mp4a.40.2",
      abr: 129.502,
      asr: 44100,
      audio_channels: 2,
    }),
    "mp4a.40.2, 130 kbps, 44.1 kHz, stereo (format 140)",
  );
});

Deno.test("a whole-numbered sample rate has no decimals", () => {
  equal(
    describeDownloadedAudio({
      format_id: "hls_mp3_128",
      acodec: "mp3",
      abr: 128,
      asr: 48000,
      audio_channels: 1,
    }),
    "mp3, 128 kbps, 48 kHz, mono (format hls_mp3_128)",
  );
  equal(
    describeDownloadedAudio({ acodec: "opus", audio_channels: 6 }),
    "opus, 6 channels",
  );
});

Deno.test("fields the site did not give are left out, not guessed", () => {
  equal(
    describeDownloadedAudio({ format_id: "http_mp3", acodec: "mp3" }),
    "mp3 (format http_mp3)",
  );
  equal(
    describeDownloadedAudio({ acodec: "none", abr: 0 }),
    "audio of an unreported kind",
  );
  equal(describeDownloadedAudio({}), "audio of an unreported kind");
});

Deno.test("yt-dlp's error line, without the noise around it", () => {
  equal(
    errorFromOutput(
      "[youtube] Extracting URL\nERROR: [youtube] dQw4w9WgXcQ: Video unavailable\n",
      "fallback",
    ).message,
    "Video unavailable",
  );
  // The last error wins.
  equal(
    errorFromOutput("ERROR: first\nsome noise\nERROR: second\n", "x").message,
    "second",
  );
  // Its command line parser.
  equal(
    errorFromOutput(
      "Usage: yt-dlp [OPTIONS] URL\n\nyt-dlp: error: no such option: --js-runtimes\n",
      "x",
    ).message,
    "no such option: --js-runtimes",
  );
  equal(
    errorFromOutput("nothing useful\r\n", "Couldn't read it").message,
    "Couldn't read it",
  );
});

Deno.test("yt-dlp versions before --js-runtimes are too old", () => {
  equal(isRecentYtDlp("2025.11.12"), true);
  equal(isRecentYtDlp("2026.08.19"), true);
  equal(isRecentYtDlp("2025.12.01"), true);
  equal(isRecentYtDlp("2025.11.11"), false);
  equal(isRecentYtDlp("2025.10.30"), false);
  equal(isRecentYtDlp("2024.12.31"), false);
  equal(isRecentYtDlp("garbage"), false);
});

const tools = { ytDlp: "yt-dlp", jsRuntime: "deno:/opt/deno" };

Deno.test("inspect lists a playlist flat, or keeps to the one video", () => {
  eq(inspectArgs(tools, "https://x.test/a", true), [
    "--ignore-config",
    "--no-warnings",
    "--js-runtimes",
    "deno:/opt/deno",
    "--dump-single-json",
    "--flat-playlist",
    "--yes-playlist",
    "--",
    "https://x.test/a",
  ]);
  ok(inspectArgs(tools, "https://x.test/a", false).includes("--no-playlist"));
});

Deno.test("fetch writes in place and reports the file before the first byte", () => {
  const args = fetchArgs(tools, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
    directory: "/cache/dj-songs/",
    name: "3f2a9c",
    knownSitesOnly: false,
    separator: "/",
  });
  for (
    const flag of [
      "--no-part",
      "--no-simulate",
      "--no-playlist",
      "--no-mtime",
      "--no-progress",
    ]
  ) {
    ok(args.includes(flag), flag);
  }
  equal(args[args.indexOf("--fixup") + 1], "never");
  equal(args[args.indexOf("-f") + 1], formatSelector);
  equal(args[args.indexOf("--format-sort") + 1], "abr,asr");
  equal(args[args.indexOf("-o") + 1], "/cache/dj-songs/3f2a9c.%(ext)s");
  const prints = args.flatMap((a, i) => (args[i - 1] === "--print" ? [a] : []));
  ok(
    prints[0].startsWith(
      `before_dl:${startMark}%(.{filename,filesize,title,`,
    ),
  );
  ok(prints[1].startsWith(`after_move:${doneMark}%(.{filepath,`));
  eq(args.slice(-2), ["--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
  ok(!args.includes("--use-extractors"));
});

Deno.test("an untrusted fetch leaves the generic extractor out", () => {
  const args = fetchArgs(tools, "ytsearch1:a - b", {
    directory: "C:\\cache\\50%",
    name: "k",
    knownSitesOnly: true,
    separator: "\\",
  });
  equal(args[args.indexOf("--use-extractors") + 1], "default,-generic");
  // `%` is template syntax in yt-dlp's output name.
  equal(args[args.indexOf("-o") + 1], "C:\\cache\\50%%\\k.%(ext)s");
});

Deno.test("Opus is taken first, at 96 kbps or more, over plain HTTP", () => {
  const alternatives = formatSelector.split("/");
  equal(alternatives[0], "ba[acodec=opus][abr>=96][protocol^=http][ext=webm]");
  equal(alternatives.at(-1), "ba[protocol^=http]");
  ok(alternatives.includes("b[ext=mp4][protocol^=http][height<=480]"));
});

Deno.test("the last JSON object in yt-dlp's output", () => {
  eq(lastJsonObject('noise\n{"a":1}\n{"b":2}\n[1]\nmore\n'), { b: 2 });
  eq(lastJsonObject('{"a":1}\r\n{broken\r\n'), { a: 1 });
  equal(lastJsonObject("nothing\n"), null);
});
