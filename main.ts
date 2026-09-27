// yt-dlp music: a DJ source extension (protocol 1). See README.md.
//
// Run as `deno run … main.ts --yt-dlp <path> <verb> <request-json>`: the
// manifest gives everything up to the path, the app appends the verb and the
// request. Answers are JSON objects on stdout, one per line; everything else
// (yt-dlp's own output included) goes to stderr, which the app logs.
import { fetchSong } from "./src/fetch.ts";
import {
  installExitHandlers,
  log,
  settleGuards,
  shutdown,
  writeAllSync,
} from "./src/process.ts";
import {
  parseArgs,
  parseFetchRequest,
  parseResolveRequest,
} from "./src/protocol.ts";
import { resolve } from "./src/resolve.ts";
import { updateInBackground } from "./src/update.ts";
import type { YtDlpTools } from "./src/yt_dlp.ts";

function answer(value: unknown): void {
  writeAllSync(Deno.stdout, `${JSON.stringify(value)}\n`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** yt-dlp as the manifest gave it, else ours in deps/, else on PATH. */
function locateYtDlp(given: string | undefined): {
  path: string;
  managed: boolean;
} {
  if (given !== undefined && given !== "") {
    return { path: given, managed: true };
  }
  const exe = Deno.build.os === "windows" ? ".exe" : "";
  const deps = new URL(`./deps/yt-dlp${exe}`, import.meta.url);
  if (deps.protocol === "file:") {
    const path = decodeURIComponent(deps.pathname).replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
    try {
      Deno.statSync(path);
      return { path, managed: true };
    } catch {
      // Not there.
    }
  }
  return { path: "yt-dlp", managed: false };
}

/**
 * yt-dlp's updater on Windows moves the running program aside as
 * `yt-dlp.exe.old` before putting the new one in place. An update cut off
 * between the two leaves only the old one: put it back.
 */
function recoverInterruptedUpdate(path: string): void {
  try {
    Deno.statSync(path);
  } catch {
    try {
      Deno.renameSync(`${path}.old`, path);
      log(`yt-dlp: restored ${path} after an interrupted update`);
    } catch {
      // Nothing to restore.
    }
  }
}

async function main(): Promise<number> {
  installExitHandlers();
  let invocation;
  try {
    invocation = parseArgs(Deno.args);
  } catch (e) {
    answer({ error: messageOf(e) });
    return 2;
  }
  const ytDlp = locateYtDlp(invocation.ytDlp);
  if (ytDlp.managed) recoverInterruptedUpdate(ytDlp.path);
  const tools: YtDlpTools = {
    ytDlp: ytDlp.path,
    // yt-dlp needs a JavaScript runtime for YouTube's player challenges: the
    // Deno running us.
    jsRuntime: `deno:${Deno.execPath()}`,
  };
  try {
    if (invocation.verb === "resolve") {
      const request = parseResolveRequest(invocation.request);
      if (ytDlp.managed) await updateInBackground(ytDlp.path, request.data);
      answer({ tracks: await resolve(request.url, { tools }) });
    } else {
      const request = parseFetchRequest(invocation.request);
      if (ytDlp.managed) await updateInBackground(ytDlp.path, request.data);
      await fetchSong(request, tools, answer);
    }
    return 0;
  } catch (e) {
    answer({ error: messageOf(e) });
    return 1;
  } finally {
    await settleGuards();
  }
}

if (import.meta.main) shutdown(await main());
