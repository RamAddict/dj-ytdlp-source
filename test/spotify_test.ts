// Spotify embed pages and short links, without the network.
import { deepStrictEqual as eq, equal, rejects } from "node:assert/strict";
import { parseLink } from "../src/links.ts";
import {
  followSpotifyRedirects,
  parseSpotifyEmbed,
  searchFor,
  spotifyTracks,
} from "../src/spotify.ts";
import { resolve } from "../src/resolve.ts";

function page(entity: unknown): string {
  const data = { props: { pageProps: { state: { data: { entity } } } } };
  return `<html><head></head><body><div id="root"></div>` +
    `<script id="__NEXT_DATA__" type="application/json">${
      JSON.stringify(data)
    }</script></body></html>`;
}

const track = parseLink(
  "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
)!;
const album = parseLink(
  "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv",
)!;
const playlist = parseLink(
  "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
)!;

const cover = [
  { url: "https://i.scdn.co/image/64", width: 64 },
  { url: "https://i.scdn.co/image/300", width: 300 },
  { url: "https://i.scdn.co/image/640", width: 640 },
];

Deno.test("a Spotify track becomes a YouTube search that keeps Spotify's names", () => {
  eq(
    parseSpotifyEmbed(
      page({
        type: "track",
        name: "Never Gonna Give You Up",
        artists: [{ name: "Rick Astley" }, { name: "" }, { nope: 1 }],
        duration: 213573,
        coverArt: { sources: cover },
      }),
      track,
    ),
    [{
      source: "ytsearch1:Rick Astley - Never Gonna Give You Up",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      durationMs: 213573,
      thumbnail: "https://i.scdn.co/image/300",
      link: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
      label: "Spotify",
    }],
  );
});

Deno.test("an album's tracks share its cover and link to themselves", () => {
  eq(
    parseSpotifyEmbed(
      page({
        type: "album",
        visualIdentity: { image: cover },
        trackList: [
          {
            title: "One",
            subtitle: "Band",
            duration: 1000,
            uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa",
          },
          { title: "Two", subtitle: " ", uri: "spotify:episode:x" },
          { subtitle: "no title" },
        ],
      }),
      album,
    ),
    [
      {
        source: "ytsearch1:Band - One",
        title: "One",
        artist: "Band",
        durationMs: 1000,
        thumbnail: "https://i.scdn.co/image/300",
        link: "https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaaa",
        label: "Spotify",
      },
      {
        source: "ytsearch1:Two",
        title: "Two",
        thumbnail: "https://i.scdn.co/image/300",
        link: "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv",
        label: "Spotify",
      },
    ],
  );
});

Deno.test("a playlist's tracks have no art: the page has none per track", () => {
  const tracks = parseSpotifyEmbed(
    page({
      type: "playlist",
      coverArt: { sources: cover },
      trackList: [{
        title: "Song",
        subtitle: "Artist",
        uri: "spotify:track:bbbbbbbbbbbbbbbbbbbbbb",
      }],
    }),
    playlist,
  );
  equal(tracks.length, 1);
  equal(tracks[0].thumbnail, undefined);
});

Deno.test("pages without the data give nothing", () => {
  eq(parseSpotifyEmbed("<html></html>", track), []);
  eq(
    parseSpotifyEmbed(
      '<script id="__NEXT_DATA__" type="application/json">{broken</script>',
      track,
    ),
    [],
  );
  eq(parseSpotifyEmbed(page({ type: "track" }), track), []);
  eq(parseSpotifyEmbed(page("nope"), track), []);
});

Deno.test("searches stay within the 900 characters a source may have", () => {
  equal(searchFor("t".repeat(2000), "a").length, 900);
});

function fakeFetch(
  routes: Record<string, () => Response>,
  seen: string[] = [],
): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    seen.push(url);
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response("", { status: 404 }));
  }) as typeof fetch;
}

Deno.test("the embed page is asked for, by type and id", async () => {
  const seen: string[] = [];
  const tracks = await spotifyTracks(
    album,
    fakeFetch({
      "https://open.spotify.com/embed/album/4LH4d3cOWNNsVw41Gqt2kv": () =>
        new Response(page({ type: "album", trackList: [{ title: "One" }] })),
    }, seen),
  );
  eq(seen, ["https://open.spotify.com/embed/album/4LH4d3cOWNNsVw41Gqt2kv"]);
  equal(tracks[0].source, "ytsearch1:One");
  await rejects(spotifyTracks(track, fakeFetch({})), /Spotify answered 404/);
  await rejects(
    spotifyTracks(
      track,
      fakeFetch({
        "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT": () =>
          new Response("<html>"),
      }),
    ),
    /No songs found on that Spotify page/,
  );
});

const redirect = (to: string) => () =>
  new Response(null, { status: 302, headers: { location: to } });

Deno.test("short links are followed to the open.spotify.com page", async () => {
  equal(
    await followSpotifyRedirects(
      "https://spotify.link/AbC",
      fakeFetch({
        "https://spotify.link/AbC": redirect(
          "https://spotify.app.link/AbC?x=1",
        ),
        "https://spotify.app.link/AbC?x=1": redirect(
          "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=z",
        ),
      }),
    ),
    "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=z",
  );
  // A page that doesn't redirect is where it leads.
  equal(
    await followSpotifyRedirects(
      "https://spotify.link/x",
      fakeFetch({ "https://spotify.link/x": () => new Response("hi") }),
    ),
    "https://spotify.link/x",
  );
  // Round and round: nowhere.
  equal(
    await followSpotifyRedirects(
      "https://spotify.link/loop",
      fakeFetch({ "https://spotify.link/loop": redirect("/loop") }),
    ),
    null,
  );
});

Deno.test("resolving a short link resolves where it leads", async () => {
  const tools = { ytDlp: "/nonexistent/yt-dlp", jsRuntime: "deno" };
  const fetcher = fakeFetch({
    "https://spotify.link/AbC": redirect(
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    ),
    "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT": () =>
      new Response(
        page({ type: "track", name: "Song", artists: [{ name: "Artist" }] }),
      ),
    "https://spotify.link/home": redirect("https://open.spotify.com/"),
  });
  const tracks = await resolve("https://spotify.link/AbC", { tools, fetcher });
  equal(tracks[0].source, "ytsearch1:Artist - Song");
  await rejects(
    resolve("https://spotify.link/home", { tools, fetcher }),
    /That Spotify link doesn't lead to a song/,
  );
});
