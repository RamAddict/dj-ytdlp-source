// Link recognition and normalisation, ported from the booth's own tests.
import { deepStrictEqual as eq, equal } from "node:assert/strict";
import {
  isCollection,
  isSpotifyShortLink,
  type Link,
  parseAllLinks,
  parseLink,
  siteOf,
  youtubeThumbnail,
  youtubeVideoId,
} from "../src/links.ts";

const p = (s: string): Link | null => parseLink(s);

Deno.test("YouTube videos in all their forms", () => {
  for (
    const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx&index=3",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    ]
  ) {
    const link = p(url);
    equal(link?.type, "youtubeVideo", url);
    equal(link?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", url);
    equal(link?.id, "dQw4w9WgXcQ", url);
  }
});

Deno.test("YouTube playlists", () => {
  const link = p("https://www.youtube.com/playlist?list=PLabc123");
  equal(link?.type, "youtubePlaylist");
  equal(link?.url, "https://www.youtube.com/playlist?list=PLabc123");
  equal(isCollection(link!.type), true);
});

Deno.test("YouTube pages that are not songs", () => {
  equal(p("https://www.youtube.com/"), null);
  equal(p("https://www.youtube.com/@somechannel"), null);
  equal(p("https://www.youtube.com/watch?v=short"), null);
});

Deno.test("SoundCloud tracks and sets", () => {
  equal(
    p("https://soundcloud.com/artist/track-name?utm_source=x")?.url,
    "https://soundcloud.com/artist/track-name",
  );
  const set = p("https://soundcloud.com/artist/sets/my-set");
  equal(set?.type, "soundcloudSet");
  equal(isCollection(set!.type), true);
  equal(p("https://on.soundcloud.com/AbCdE")?.type, "soundcloudTrack");
  equal(
    p("https://on.soundcloud.com/AbCdE?si=1")?.url,
    "https://on.soundcloud.com/AbCdE",
  );
  equal(p("https://soundcloud.com/discover/sets/x")?.type, "soundcloudSet");
  equal(p("https://soundcloud.com/you/likes"), null);
  equal(isCollection(p("https://soundcloud.com/a/b")!.type), false);
});

Deno.test("Spotify tracks, albums and playlists", () => {
  equal(
    p("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x")?.url,
    "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  );
  equal(
    p("https://open.spotify.com/intl-de/album/4LH4d3cOWNNsVw41Gqt2kv")?.type,
    "spotifyAlbum",
  );
  const playlist = p(
    "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
  );
  equal(siteOf(playlist!.type), "spotify");
  equal(isCollection(playlist!.type), true);
  equal(p("https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt"), null);
  equal(p("https://open.spotify.com/"), null);
});

Deno.test("pasted text with several links, some bare, keeps order", () => {
  const links = parseAllLinks(`
Queue these:
https://youtu.be/dQw4w9WgXcQ,
youtube.com/watch?v=aaaaaaaaaaa
(https://soundcloud.com/a/b)
https://youtu.be/dQw4w9WgXcQ
not a link
`);
  eq(links.map((l) => l.url), [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    "https://soundcloud.com/a/b",
  ]);
});

Deno.test("other links are passed on, garbage is not", () => {
  equal(p("https://bandcamp.com/track/x")?.type, "other");
  equal(
    p("http://bandcamp.com/track/x?utm_medium=y&a=1")?.url,
    "https://bandcamp.com/track/x?a=1",
  );
  equal(p("ftp://x"), null);
  equal(p("hello"), null);
  equal(p("https://"), null);
  equal(p("https://soundcloud.com/a/%E0%A4%A"), null);
});

Deno.test("Spotify short links are told apart", () => {
  equal(isSpotifyShortLink("https://spotify.link/AbC"), true);
  equal(isSpotifyShortLink("https://spotify.app.link/AbC"), true);
  equal(isSpotifyShortLink("https://open.spotify.com/track/x"), false);
  equal(p("https://spotify.link/AbC")?.type, "other");
});

Deno.test("YouTube ids and thumbnails", () => {
  equal(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  equal(youtubeVideoId("https://soundcloud.com/a/b"), null);
  equal(
    youtubeThumbnail("dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  );
});
