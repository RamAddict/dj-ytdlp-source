// Arguments, requests, what may be fetched, and when to update.
import { deepStrictEqual as eq, equal, throws } from "node:assert/strict";
import {
  isFetchable,
  parseArgs,
  parseFetchRequest,
  parseResolveRequest,
} from "../src/protocol.ts";
import { updateDue } from "../src/update.ts";

Deno.test("the verb and the request come last, the manifest's arguments first", () => {
  eq(
    parseArgs([
      "--yt-dlp",
      "/x/deps/yt-dlp",
      "resolve",
      '{"protocol":1,"url":"u"}',
    ]),
    {
      verb: "resolve",
      request: { protocol: 1, url: "u" },
      ytDlp: "/x/deps/yt-dlp",
    },
  );
  eq(parseArgs(["--yt-dlp=/y", "--later-option", "fetch", "{}"]), {
    verb: "fetch",
    request: {},
    ytDlp: "/y",
  });
  eq(parseArgs(["fetch", "{}"]), { verb: "fetch", request: {} });
  throws(() => parseArgs([]), /verb and a request/);
  throws(() => parseArgs(["resolve"]), /verb and a request/);
  throws(() => parseArgs(["--yt-dlp", "/x", "resolve"]), /verb and a request/);
  throws(
    () => parseArgs(["--yt-dlp", "x", "play", "{}"]),
    /Unknown verb: play/,
  );
  throws(() => parseArgs(["resolve", "{nope"]), /not JSON/);
});

Deno.test("requests speak protocol 1", () => {
  eq(parseResolveRequest({ protocol: 1, data: "/d", url: "https://a.b" }), {
    url: "https://a.b",
    data: "/d",
  });
  throws(
    () => parseResolveRequest({ protocol: 2, url: "x" }),
    /Protocol 2 is not supported/,
  );
  throws(() => parseResolveRequest({ url: "x" }), /Protocol undefined/);
  throws(() => parseResolveRequest({ protocol: 1 }), /no url/);
  throws(() => parseResolveRequest([1]), /not an object/);
});

Deno.test("fetch requests: a file name, and trust only when said", () => {
  const base = {
    protocol: 1,
    data: "/d",
    source: "https://a.b/c",
    directory: "/songs",
  };
  eq(parseFetchRequest({ ...base, name: "3f2a", trusted: true }), {
    source: "https://a.b/c",
    directory: "/songs",
    name: "3f2a",
    trusted: true,
    data: "/d",
  });
  equal(parseFetchRequest({ ...base, name: "3f2a" }).trusted, false);
  equal(
    parseFetchRequest({ ...base, name: "3f2a", trusted: "yes" }).trusted,
    false,
  );
  for (const name of ["../x", "a/b", "a\\b", "..", ".", "", 5]) {
    throws(
      () => parseFetchRequest({ ...base, name }),
      /not a file name/,
      String(name),
    );
  }
  throws(
    () => parseFetchRequest({ ...base, name: "n", source: "" }),
    /no source/,
  );
  throws(
    () => parseFetchRequest({ ...base, name: "n", directory: 1 }),
    /no directory/,
  );
});

Deno.test("what may be fetched", () => {
  // What this extension hands out, and what older clients queued.
  equal(
    isFetchable("https://www.youtube.com/watch?v=dQw4w9WgXcQ", false),
    true,
  );
  equal(isFetchable("https://soundcloud.com/a/b", false), true);
  equal(
    isFetchable("ytsearch1:Rick Astley - Never Gonna Give You Up", false),
    true,
  );
  equal(isFetchable("ytsearch1:", true), false);
  equal(isFetchable("ytsearch1:   ", true), false);
  // Plain http only for what this user queued.
  equal(isFetchable("http://artist.bandcamp.com/track/x", true), true);
  equal(isFetchable("http://artist.bandcamp.com/track/x", false), false);
  // No other extractor prefixes, schemes or files.
  for (
    const source of [
      "ytsearch50:everything",
      "scsearch1:x",
      "file:///etc/passwd",
      "--exec=rm",
      "ftp://a.b/c",
      "https://user:pw@a.b/c",
    ]
  ) {
    equal(isFetchable(source, true), false, source);
  }
  // No addresses or local names.
  for (
    const host of [
      "127.0.0.1",
      "127.1",
      "0x7f.1",
      "[::1]",
      "localhost",
      "printer.local",
      "a.localhost",
      "db.internal",
      "intranet",
    ]
  ) {
    equal(isFetchable(`https://${host}/x`, true), false, host);
  }
});

const day = 24 * 60 * 60 * 1000;

Deno.test("yt-dlp updates at most once a day", () => {
  const now = 1_800_000_000_000;
  equal(updateDue(null, now), true);
  equal(updateDue("garbage", now), true);
  equal(updateDue(String(now - day + 1000), now), false);
  equal(updateDue(`${now - day}\n`, now), true);
  // A stamp far in the future (the clock was wrong): don't wait for it.
  equal(updateDue(String(now + 2 * day), now), true);
});
