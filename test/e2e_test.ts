// The extension end to end, as the app runs it (the manifest's command line,
// the verb and request appended), against a fake yt-dlp. Linux only: the
// fake is a shell script.
import { deepStrictEqual as eq, equal, ok } from "node:assert/strict";

const root = new URL("../", import.meta.url).pathname;
const manifest = JSON.parse(
  Deno.readTextFileSync(`${root}/roscord-extension.json`),
);
const linux = Deno.build.os === "linux";

const fake = `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case " $* " in *" -U "*) echo updated >> "$FAKE_LOG.update"; exit 0;; esac
case " $* " in *" --version "*) echo "\${FAKE_VERSION:-2026.08.19}"; exit 0;; esac
case " $* " in *" --dump-single-json "*)
  case "$FAKE_MODE" in
    playlist) echo '{"_type":"playlist","entries":[{"ie_key":"Youtube","id":"aaaaaaaaaaa","url":"https://www.youtube.com/watch?v=aaaaaaaaaaa","title":"A","channel":"Chan - Topic","duration":61}]}';;
    empty) echo '{"_type":"playlist","entries":[]}';;
    fail) echo "ERROR: [youtube] xyz: Video unavailable" >&2; exit 1;;
    old) echo "yt-dlp: error: no such option: --js-runtimes" >&2; exit 2;;
    *) echo 'noise'; echo '{"extractor_key":"Youtube","id":"dQw4w9WgXcQ","webpage_url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","title":"Never","uploader":"Rick","duration":212.5}';;
  esac
  exit 0;;
esac
out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; src="$a"; done
file=$(echo "$out" | sed 's/%(ext)s/webm/')
start() { echo "djsource-start {\\"filename\\": \\"$file\\", \\"filesize\\": 5, \\"title\\": \\"Song\\", \\"uploader\\": \\"Artist\\", \\"duration\\": 3, \\"acodec\\": \\"opus\\", \\"abr\\": 130, \\"format_id\\": \\"251\\"}"; }
done_() { echo "djsource-done {\\"filepath\\": \\"$file\\", \\"title\\": \\"Song\\"}"; }
runs=$(cat "$FAKE_LOG.runs" 2>/dev/null || echo 0); runs=$((runs+1)); echo $runs > "$FAKE_LOG.runs"
case "$FAKE_MODE" in
  ok) start; printf 'audio' > "$file"; done_;;
  failonce) start; : > "$file"; if [ $runs -eq 1 ]; then echo "ERROR: HTTP Error 403: Forbidden" >&2; exit 1; fi; printf 'audio' > "$file"; done_;;
  failwritten) start; printf 'au' > "$file"; echo "ERROR: [youtube] x: connection reset" >&2; exit 1;;
  failtwice) start; : > "$file"; echo "ERROR: HTTP Error 403: Forbidden" >&2; exit 1;;
  otherformat) if [ $runs -eq 2 ]; then file=$(echo "$out" | sed 's/%(ext)s/m4a/'); fi; start; : > "$file"; if [ $runs -eq 1 ]; then echo "ERROR: HTTP Error 403: Forbidden" >&2; exit 1; fi; printf 'audio' > "$file"; done_;;
  hang) start; echo $$ > "$FAKE_LOG.pid"; exec sleep 60;;
esac
`;

interface Env {
  dir: string;
  ytDlp: string;
  log: string;
  songs: string;
  data: string;
}

function setUp(): Env {
  const dir = Deno.makeTempDirSync({ prefix: "djsource-" });
  const ytDlp = `${dir}/yt-dlp`;
  Deno.writeTextFileSync(ytDlp, fake);
  Deno.chmodSync(ytDlp, 0o755);
  Deno.mkdirSync(`${dir}/songs`);
  Deno.mkdirSync(`${dir}/data`);
  return {
    dir,
    ytDlp,
    log: `${dir}/log`,
    songs: `${dir}/songs`,
    data: `${dir}/data`,
  };
}

/** The manifest's command line with its placeholders filled in. */
function commandLine(env: Env, verb: string, request: unknown): string[] {
  const args = (manifest.run.args as string[]).map((a) =>
    a.replace("{dir}", root.replace(/\/$/, "")).replace(
      "{dep:yt-dlp}",
      env.ytDlp,
    )
  );
  return [...args, verb, JSON.stringify(request)];
}

function start(env: Env, mode: string, verb: string, request: unknown) {
  return new Deno.Command(Deno.execPath(), {
    args: commandLine(env, verb, request),
    cwd: root,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { FAKE_LOG: env.log, FAKE_MODE: mode },
  }).spawn();
}

async function run(env: Env, mode: string, verb: string, request: unknown) {
  const output = await start(env, mode, verb, request).output();
  const lines = new TextDecoder().decode(output.stdout).split("\n").filter((
    l,
  ) => l !== "");
  return {
    code: output.code,
    answers: lines.map((l) => JSON.parse(l)),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function ytDlpRuns(env: Env): string[] {
  try {
    return Deno.readTextFileSync(env.log).split("\n").filter((l) =>
      l !== "" && l !== "-U"
    );
  } catch {
    return [];
  }
}

const t = (name: string, fn: () => Promise<void>) =>
  Deno.test({
    name,
    ignore: !linux,
    sanitizeOps: false,
    sanitizeResources: false,
    fn,
  });

t("resolve: one video", async () => {
  const env = setUp();
  const { code, answers } = await run(env, "single", "resolve", {
    protocol: 1,
    url: "https://youtu.be/dQw4w9WgXcQ?si=share",
  });
  equal(code, 0);
  eq(answers, [{
    tracks: [{
      source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never",
      artist: "Rick",
      durationMs: 212500,
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      label: "YouTube",
    }],
  }]);
  const [args] = ytDlpRuns(env);
  ok(args.includes("--no-playlist"), args);
  ok(args.includes(`--js-runtimes deno:${Deno.execPath()}`), args);
  ok(args.endsWith("-- https://www.youtube.com/watch?v=dQw4w9WgXcQ"), args);
});

t("resolve: a playlist is listed with --yes-playlist", async () => {
  const env = setUp();
  const { answers } = await run(env, "playlist", "resolve", {
    protocol: 1,
    url: "https://www.youtube.com/playlist?list=PLabc",
  });
  equal(answers[0].tracks[0].artist, "Chan");
  ok(ytDlpRuns(env)[0].includes("--yes-playlist --"));
});

t("resolve: errors come back as one error line", async () => {
  const env = setUp();
  eq(
    (await run(env, "empty", "resolve", {
      protocol: 1,
      url: "https://soundcloud.com/a/sets/b",
    })).answers,
    [
      { error: "Nothing playable in that link" },
    ],
  );
  eq(
    (await run(env, "fail", "resolve", {
      protocol: 1,
      url: "https://soundcloud.com/a/b",
    })).answers,
    [
      { error: "Video unavailable" },
    ],
  );
  eq(
    (await run(env, "x", "resolve", { protocol: 1, url: "not a link" }))
      .answers,
    [
      { error: "That isn't a web link" },
    ],
  );
  eq(
    (await run(env, "x", "resolve", {
      protocol: 1,
      url: "https://www.youtube.com/@channel",
    })).answers,
    [
      { error: "Nothing playable in that link" },
    ],
  );
  eq(
    (await run(env, "old", "resolve", {
      protocol: 1,
      url: "https://soundcloud.com/a/b",
    })).answers,
    [
      { error: "no such option: --js-runtimes" },
    ],
  );
  const old = await new Deno.Command(Deno.execPath(), {
    args: commandLine(env, "resolve", {
      protocol: 1,
      url: "https://soundcloud.com/a/b",
    }),
    stdout: "piped",
    env: { FAKE_LOG: env.log, FAKE_MODE: "old", FAKE_VERSION: "2024.12.31" },
  }).output();
  eq(JSON.parse(new TextDecoder().decode(old.stdout)), {
    error:
      "yt-dlp 2024.12.31 is too old, 2025.11.12 or newer is needed; install the extension again",
  });
});

t("fetch: started before the first byte, then done", async () => {
  const env = setUp();
  const { code, answers } = await run(env, "ok", "fetch", {
    protocol: 1,
    data: env.data,
    source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    directory: env.songs,
    name: "3f2a9c",
    trusted: true,
  });
  equal(code, 0);
  const path = `${env.songs}/3f2a9c.webm`;
  eq(answers, [
    {
      started: {
        path,
        size: 5,
        durationMs: 3000,
        title: "Song",
        artist: "Artist",
        audio: "opus, 130 kbps (format 251)",
      },
    },
    { done: { path } },
  ]);
  equal(Deno.readTextFileSync(path), "audio");
  const [args] = ytDlpRuns(env);
  ok(!args.includes("--use-extractors"), args);
  ok(args.includes(`-o ${env.songs}/3f2a9c.%(ext)s`), args);
});

t("fetch: an untrusted source never gets the generic extractor", async () => {
  const env = setUp();
  const { answers } = await run(env, "ok", "fetch", {
    protocol: 1,
    source: "ytsearch1:Artist - Song",
    directory: env.songs,
    name: "k",
    trusted: false,
  });
  ok("done" in answers[1]);
  ok(ytDlpRuns(env)[0].includes("--use-extractors default,-generic"));
  eq(
    (await run(env, "ok", "fetch", {
      protocol: 1,
      source: "http://example.org/x",
      directory: env.songs,
      name: "k",
    })).answers,
    [{ error: "That link can't be played" }],
  );
});

t("fetch: asked again after a refusal, with the empty file gone", async () => {
  const env = setUp();
  const { answers } = await run(env, "failonce", "fetch", {
    protocol: 1,
    source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    directory: env.songs,
    name: "k",
    trusted: true,
  });
  equal(ytDlpRuns(env).length, 2);
  // `started` once, for the first run; `done` after the second.
  equal(answers.length, 2);
  ok("started" in answers[0]);
  eq(answers[1], { done: { path: `${env.songs}/k.webm` } });
});

t("fetch: not asked again once some of the song is written", async () => {
  const env = setUp();
  const { code, answers } = await run(env, "failwritten", "fetch", {
    protocol: 1,
    source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    directory: env.songs,
    name: "k",
    trusted: true,
  });
  equal(code, 1);
  equal(ytDlpRuns(env).length, 1);
  ok("started" in answers[0]);
  eq(answers[1], { error: "connection reset" });
});

t("fetch: two refusals are an error", async () => {
  const env = setUp();
  const { answers } = await run(env, "failtwice", "fetch", {
    protocol: 1,
    source: "https://soundcloud.com/a/b",
    directory: env.songs,
    name: "k",
    trusted: true,
  });
  equal(ytDlpRuns(env).length, 2);
  eq(answers.at(-1), { error: "HTTP Error 403: Forbidden" });
});

t(
  "fetch: a retry in another format is an error, not done with another file",
  async () => {
    const env = setUp();
    const { code, answers } = await run(env, "otherformat", "fetch", {
      protocol: 1,
      source: "https://soundcloud.com/a/b",
      directory: env.songs,
      name: "k",
      trusted: true,
    });
    equal(code, 1);
    equal(ytDlpRuns(env).length, 2);
    eq(answers, [
      {
        started: {
          path: `${env.songs}/k.webm`,
          size: 5,
          durationMs: 3000,
          title: "Song",
          artist: "Artist",
          audio: "opus, 130 kbps (format 251)",
        },
      },
      { error: "The download came back in another format than it started in" },
    ]);
    // The stray file is not left behind.
    eq([...Deno.readDirSync(env.songs)].map((e) => e.name), []);
  },
);

t("bad invocations answer with an error line", async () => {
  const env = setUp();
  const missing = { ...env, ytDlp: "/nonexistent/yt-dlp" };
  eq(
    (await run(missing, "ok", "resolve", {
      protocol: 1,
      url: "https://soundcloud.com/a/b",
    })).answers,
    [
      {
        error:
          "yt-dlp is missing (/nonexistent/yt-dlp); install the extension again",
      },
    ],
  );
  eq((await run(env, "ok", "resolve", { protocol: 7, url: "x" })).answers, [
    { error: "Protocol 7 is not supported, this extension speaks 1" },
  ]);
  eq((await run(env, "ok", "dance", {})).answers, [{
    error: "Unknown verb: dance",
  }]);
});

t("yt-dlp updates itself once a day, in the background", async () => {
  const env = setUp();
  const request = {
    protocol: 1,
    data: env.data,
    url: "https://soundcloud.com/a/b",
  };
  await run(env, "single", "resolve", request);
  await run(env, "single", "resolve", request);
  const stamp = Number(Deno.readTextFileSync(`${env.data}/yt-dlp-last-update`));
  ok(Math.abs(Date.now() - stamp) < 60_000);
  for (let i = 0; i < 50; i++) {
    try {
      Deno.statSync(`${env.log}.update`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  equal(Deno.readTextFileSync(`${env.log}.update`), "updated\n");
  // Without a data folder there is nowhere to remember it: no update.
  const bare = setUp();
  await run(bare, "single", "resolve", {
    protocol: 1,
    url: "https://soundcloud.com/a/b",
  });
  await new Promise((r) => setTimeout(r, 500));
  equal(ytDlpRuns(bare).length, 1);
});

/**
 * Whether a process is still running (a zombie is as good as gone). Read
 * with `cat`: Deno keeps /proc from tests without --allow-all.
 */
async function running(pid: number): Promise<boolean> {
  const out = await new Deno.Command("cat", {
    args: [`/proc/${pid}/stat`],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return false;
  return !/^\d+ \(.*\) Z/.test(new TextDecoder().decode(out.stdout));
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  ms: number,
): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return await check();
}

async function hangingFetch(env: Env) {
  const child = start(env, "hang", "fetch", {
    protocol: 1,
    source: "https://soundcloud.com/a/b",
    directory: env.songs,
    name: "k",
    trusted: true,
  });
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const { value } = await reader.read();
  ok(value?.includes('"started"'), value);
  const pidFile = `${env.log}.pid`;
  ok(
    await waitFor(() => {
      try {
        return Deno.readTextFileSync(pidFile).trim() !== "";
      } catch {
        return false;
      }
    }, 5000),
  );
  const pid = Number(Deno.readTextFileSync(pidFile));
  ok(await running(pid), `yt-dlp (${pid}) is not running`);
  return { child, reader, pid };
}

t("a SIGTERM from the app ends yt-dlp too", async () => {
  const env = setUp();
  const { child, reader, pid } = await hangingFetch(env);
  child.kill("SIGTERM");
  await child.status;
  await reader.cancel();
  await child.stderr.cancel();
  ok(
    await waitFor(async () => !(await running(pid)), 5000),
    "yt-dlp outlived the extension",
  );
});

t("yt-dlp is ended even when the extension is killed outright", async () => {
  const env = setUp();
  const { child, reader, pid } = await hangingFetch(env);
  child.kill("SIGKILL");
  await child.status;
  await reader.cancel();
  await child.stderr.cancel();
  // The guard (src/watchdog.ts) sees its pipe close and ends yt-dlp.
  ok(
    await waitFor(async () => !(await running(pid)), 8000),
    "yt-dlp outlived the extension",
  );
});
