// Queue entries from yt-dlp's `--dump-single-json --flat-playlist`.
import { deepStrictEqual as eq, equal } from "node:assert/strict";
import { parseLink } from "../src/links.ts";
import { titleFromUrl, tracksFromYtDlp } from "../src/tracks.ts";
import { startedFrom } from "../src/fetch.ts";

const video = parseLink("https://youtu.be/dQw4w9WgXcQ")!;

Deno.test("one YouTube video: canonical link, its thumbnail, no Topic", () => {
  eq(
    tracksFromYtDlp({
      id: "dQw4w9WgXcQ",
      extractor_key: "Youtube",
      webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=x",
      title: "Never Gonna Give You Up",
      channel: "Rick Astley - Topic",
      duration: 212.5,
      thumbnail: "https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp",
    }, video),
    [{
      source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      durationMs: 212500,
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      label: "YouTube",
    }],
  );
});

Deno.test("a flat YouTube playlist: every entry, music fields first", () => {
  const link = parseLink("https://www.youtube.com/playlist?list=PLabc")!;
  const tracks = tracksFromYtDlp({
    _type: "playlist",
    entries: [
      {
        ie_key: "Youtube",
        id: "aaaaaaaaaaa",
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        title: "Artist - Song (Official Video)",
        track: "Song",
        artists: ["Artist", "Guest"],
        duration: 61,
      },
      "not an entry",
      { ie_key: "Youtube", title: "no url" },
      {
        ie_key: "Youtube",
        id: "bbbbbbbbbbb",
        url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        title: "  ",
        uploader: "Someone",
      },
    ],
  }, link);
  eq(tracks, [
    {
      source: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      title: "Song",
      artist: "Artist, Guest",
      durationMs: 61000,
      thumbnail: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
      label: "YouTube",
    },
    {
      source: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
      // No title: made from the link.
      title: "Watch",
      artist: "Someone",
      thumbnail: "https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg",
      label: "YouTube",
    },
  ]);
});

Deno.test("a SoundCloud set: its tracks' links, last thumbnail, title from slug", () => {
  const link = parseLink("https://soundcloud.com/artist/sets/my-set")!;
  const tracks = tracksFromYtDlp({
    _type: "playlist",
    entries: [
      {
        ie_key: "Soundcloud",
        url: "https://soundcloud.com/artist/some-track_name",
        thumbnails: [
          { url: "https://i1.sndcdn.com/small.jpg" },
          { url: "https://i1.sndcdn.com/large.jpg" },
        ],
      },
      {
        ie_key: "Soundcloud",
        webpage_url: "https://soundcloud.com/artist/other",
        title: "Other",
        uploader: "Artist",
        duration: 180,
        thumbnail: "http://insecure.example/x.jpg",
      },
    ],
  }, link);
  eq(tracks, [
    {
      source: "https://soundcloud.com/artist/some-track_name",
      title: "Some track name",
      thumbnail: "https://i1.sndcdn.com/large.jpg",
      label: "SoundCloud",
    },
    {
      source: "https://soundcloud.com/artist/other",
      title: "Other",
      artist: "Artist",
      durationMs: 180000,
      label: "SoundCloud",
    },
  ]);
});

Deno.test("another site: no label, its own link", () => {
  const link = parseLink("https://artist.bandcamp.com/track/song")!;
  eq(
    tracksFromYtDlp({
      extractor_key: "Bandcamp",
      webpage_url: "https://artist.bandcamp.com/track/song",
      track: "Song",
      artist: "Artist",
      duration: 100,
      thumbnail: "https://f4.bcbits.com/img/a1.jpg",
    }, link),
    [{
      source: "https://artist.bandcamp.com/track/song",
      title: "Song",
      artist: "Artist",
      durationMs: 100000,
      thumbnail: "https://f4.bcbits.com/img/a1.jpg",
    }],
  );
});

Deno.test("a YouTube video found through another site's link keeps its YouTube form", () => {
  const link = parseLink("https://example.org/page")!;
  const [track] = tracksFromYtDlp({
    ie_key: "Youtube",
    url: "https://youtu.be/dQw4w9WgXcQ",
    title: "x",
  }, link);
  equal(track.source, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  equal(track.label, "YouTube");
});

Deno.test("sources over 900 characters are left out", () => {
  const link = parseLink("https://example.org/page")!;
  const long = `https://example.org/${"a".repeat(900)}`;
  eq(tracksFromYtDlp({ webpage_url: long, title: "x" }, link), []);
});

Deno.test("titles from links", () => {
  equal(
    titleFromUrl("https://soundcloud.com/artist/some-track-name"),
    "Some track name",
  );
  equal(titleFromUrl("https://example.org/"), "https://example.org/");
  equal(titleFromUrl("https://example.org/caf%C3%A9-song"), "Café song");
});

Deno.test("started: the file, its size, and what the song is", () => {
  eq(
    startedFrom("/songs/k.webm", {
      filename: "/songs/k.webm",
      filesize: null,
      filesize_approx: 3481233.6,
      id: "dQw4w9WgXcQ",
      extractor_key: "Youtube",
      title: "Never Gonna Give You Up",
      uploader: "RickAstleyVEVO",
      artist: "Rick Astley",
      duration: 212,
      thumbnail: "https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp",
      format_id: "251",
      acodec: "opus",
      abr: 132.1,
      asr: 48000,
      audio_channels: 2,
    }),
    {
      // Only an estimate: no size at all, never a wrong one.
      path: "/songs/k.webm",
      durationMs: 212000,
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      audio: "opus, 132 kbps, 48 kHz, stereo (format 251)",
    },
  );
  eq(
    startedFrom("/songs/k.mp3", {
      filesize: 1000,
      extractor_key: "Soundcloud",
    }),
    {
      path: "/songs/k.mp3",
      size: 1000,
      audio: "audio of an unreported kind",
    },
  );
});
