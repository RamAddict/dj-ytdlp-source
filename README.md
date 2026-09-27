# yt-dlp music

A DJ source extension for the Roscord desktop app. It lets the DJ booth play
links from YouTube, YouTube Music, SoundCloud and Spotify, and from the other
sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports.

This is an independent project. It is not made, endorsed or supported by the
makers of Roscord, and it is not affiliated with YouTube, SoundCloud,
Spotify or yt-dlp.

## Legal note

This extension downloads audio with yt-dlp. Downloading from YouTube (and
many other sites) outside their own players, without their ads, is against
their terms of service, and the music is usually under copyright. You are
responsible for what you download and play with it, and for doing so only
where you are allowed to. The software comes with no warranty (see
[LICENSE](LICENSE)).

## Installing

Extensions run on desktop Roscord (Linux x64/arm64, Windows x64).

1. Get `yt-dlp-music-<version>.zip` from this project's releases, or copy the
   link to it.
2. In Roscord, open the DJ booth's extensions (in the booth, or in
   Settings), choose to install an extension, and pick the file or paste the
   link.
3. Roscord shows what the extension will download and asks first: Deno (to
   run the extension, about 45 MB) and yt-dlp (about 18 MB on Windows,
   40 MB on Linux), both from their official GitHub releases.

To update, install it again from the same file or link.

Then paste a link in the booth's add bar:

| Link                                                 | Queued as                                  |
| ---------------------------------------------------- | ------------------------------------------ |
| YouTube video, Short, YouTube Music song, `youtu.be` | that song                                  |
| YouTube playlist (`/playlist?list=…`)                | every video in it                          |
| SoundCloud track, `on.soundcloud.com` share link     | that track                                 |
| SoundCloud set                                       | every track in it                          |
| Spotify track, album, playlist, `spotify.link`       | each song, played from YouTube (see below) |
| Anything else yt-dlp knows (Bandcamp, Mixcloud, …)   | what yt-dlp finds there                    |

A YouTube link to a video opened from a playlist (`watch?v=…&list=…`) queues
just that video, like a player would.

Spotify's audio is DRM protected. For Spotify links the extension reads the
song titles and artists from Spotify's public embed page (no account or API
key) and each song is played from the first YouTube search result for
"artist - title". The queue keeps Spotify's title and artist.

yt-dlp keeps itself up to date: once a day at most, a request starts
`yt-dlp -U` in the background.

## How it works

The extension speaks protocol 1 of Roscord's DJ source extensions: Roscord
runs `deno run … main.ts --yt-dlp <path> <verb> <request-json>` once per
request and reads JSON lines from its stdout.

- `resolve` (`{"url": …}`): lists what a link holds with
  `yt-dlp --dump-single-json --flat-playlist` (`--yes-playlist` for
  playlists and sets, `--no-playlist` otherwise), or reads a Spotify embed
  page. Answers `{"tracks": [...]}` or `{"error": …}`.
- `fetch` (`{"source", "directory", "name", "trusted"}`): downloads one
  song's audio to `<directory>/<name>.<ext>`, in place, preferring Opus of
  96 kbps or more, then AAC, MP3, Vorbis and FLAC, over plain HTTP. It
  answers `{"started": …}` as soon as yt-dlp names the file (so the booth
  plays it while it downloads) and `{"done": …}` once it is complete. A
  refused download is tried once more, unless some of it was already
  written. Sources from another DJ's queue (`"trusted": false`) never use
  yt-dlp's generic extractor, which would fetch any web page.
- Sources are canonical YouTube/SoundCloud links and `ytsearch1:` queries.
  Plain links and `ytsearch1:` queries queued by older Roscord versions work
  too.

A killed request takes yt-dlp with it. On Windows the app runs the extension
in a job object and ends the whole job, yt-dlp's Python child included. On
Linux the extension passes the app's SIGTERM on, and for a SIGKILL, which it
can't catch, each yt-dlp has a small guard process that ends it once the
extension is gone.

Deno runs the extension with `--allow-run --allow-read --allow-write` and
network access to Spotify's hosts only. yt-dlp, as a program it starts, is
not limited by Deno's permissions. The extension has no dependencies and
imports nothing from the network.

### Hosts

The manifest claims the YouTube, SoundCloud and Spotify hosts explicitly,
and `"*"`: any link no other installed extension claims goes to yt-dlp,
which knows well over a thousand sites. This is how the booth used to treat
links, and it's safe with how `fetch` works: a song another client named is
fetched with the generic extractor turned off, and the app refuses untrusted
links to private addresses before asking. Remove `"*"` from
`roscord-extension.json` to take only the named sites.

## Developing

Needs [Deno](https://deno.com) 2 (or Docker with `denoland/deno`).

```sh
deno task test        # unit tests, and end-to-end tests with a fake yt-dlp (Linux)
deno task check       # type check
deno lint
deno fmt --check
deno task package     # dist/yt-dlp-music-<version>.zip
```

With Docker instead of a local Deno:

```sh
docker run --rm -v "$PWD":/w -w /w denoland/deno:latest deno task test
```

`deno task package` zips `roscord-extension.json`, `main.ts`, `src/`,
`README.md` and `LICENSE` with a small built-in zip writer
(`scripts/package.ts`, no dependencies, fixed timestamps).

Try it by hand, as Roscord would run it:

```sh
deno run --no-prompt --allow-run --allow-read --allow-write --allow-net \
  main.ts --yt-dlp "$(command -v yt-dlp)" resolve \
  '{"protocol": 1, "url": "https://soundcloud.com/forss/flickermood"}'
```

To release, set `version` in `roscord-extension.json`, commit, and push a
tag `v<version>`. The workflow in `.github/workflows/release.yml` tests,
packages and attaches the zip (and its SHA-256) to a GitHub release.

## Layout

- `roscord-extension.json`: the manifest (downloads, hosts, command line).
- `main.ts`: arguments in, JSON lines out.
- `src/links.ts`: YouTube, SoundCloud and Spotify link recognition.
- `src/resolve.ts`, `src/tracks.ts`, `src/spotify.ts`: `resolve`.
- `src/fetch.ts`, `src/yt_dlp.ts`: `fetch` and the yt-dlp command lines.
- `src/process.ts`, `src/watchdog.ts`: child processes that don't outlive a
  request.
- `src/update.ts`: the daily `yt-dlp -U`.

## License

[The Unlicense](LICENSE), the same as yt-dlp: public domain.
