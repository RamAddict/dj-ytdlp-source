// Children (yt-dlp) must not outlive the request. The app kills a request
// that runs over its time:
//
// - Linux: it sends SIGTERM (Dart's Process.kill). We pass that on to
//   yt-dlp and exit.
// - Windows: killing ends only our own process, never its children, and
//   there is no signal to catch. Ctrl+C/Ctrl+Break are handled for when the
//   extension is run by hand.
//
// For what can't be caught (Windows, SIGKILL, the app itself going away),
// each yt-dlp gets a guard process (src/watchdog.ts) that ends it once our
// process is gone. On Linux a poll of our parent id also notices the app
// going away while we still run.

const children = new Set<Deno.ChildProcess>();
let installed = false;

/** Kills whatever is still running, then exits with `code`. */
export function shutdown(code: number): never {
  for (const child of children) stop(child);
  Deno.exit(code);
}

/**
 * Asks a child to end. SIGTERM rather than SIGKILL on Linux: yt-dlp's
 * release build is a launcher with Python as its child, and only a signal it
 * can catch is passed on.
 */
export function stop(child: Deno.ChildProcess): void {
  try {
    child.kill("SIGTERM");
  } catch {
    // Already gone.
  }
}

/** Wires signal handling and the parent poll up, once. */
export function installExitHandlers(): void {
  if (installed) return;
  installed = true;
  const signals: Deno.Signal[] = Deno.build.os === "windows"
    ? ["SIGINT", "SIGBREAK"]
    : ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const signal of signals) {
    try {
      Deno.addSignalListener(signal, () => shutdown(143));
    } catch {
      // Not supported here.
    }
  }
  if (Deno.build.os !== "windows") {
    // Re-parented to init or a subreaper: whoever asked is gone.
    const parent = Deno.ppid;
    const timer = setInterval(() => {
      if (Deno.ppid !== parent) shutdown(143);
    }, 1000);
    Deno.unrefTimer(timer);
  }
}

/** Where src/watchdog.ts is, as a path Deno can run. */
function watchdogPath(): string {
  const url = new URL("./watchdog.ts", import.meta.url);
  if (url.protocol !== "file:") return url.href;
  const path = decodeURIComponent(url.pathname);
  return Deno.build.os === "windows"
    ? path.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("/", "\\")
    : path;
}

/**
 * Starts the guard for `child`, and returns what releases it once the child
 * has ended normally. A guard that can't start leaves the child unguarded,
 * never the request failed.
 */
function guard(child: Deno.ChildProcess): () => void {
  let watchdog: Deno.ChildProcess;
  try {
    watchdog = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--no-prompt",
        "--no-config",
        "--allow-run",
        watchdogPath(),
        String(child.pid),
      ],
      stdin: "piped",
      // Never our stdout: the app reads it until every holder has closed it.
      stdout: "null",
      stderr: "null",
    }).spawn();
  } catch {
    return () => {};
  }
  watchdog.unref();
  const writer = watchdog.stdin.getWriter();
  return () => {
    const released = writer.write(new Uint8Array([1]))
      .then(() => writer.close())
      .catch(() => {})
      .finally(() => releasing.delete(released));
    releasing.add(released);
  };
}

const releasing = new Set<Promise<void>>();

/** Waits until every guard has been told its child ended normally. */
export async function settleGuards(): Promise<void> {
  while (releasing.size > 0) await Promise.all([...releasing]);
}

/** Starts `program`, killed with us and guarded against outliving us. */
export function spawnTracked(
  program: string,
  args: string[],
): Deno.ChildProcess {
  const child = new Deno.Command(program, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  children.add(child);
  const release = guarded ? guard(child) : () => {};
  child.status.finally(() => {
    children.delete(child);
    release();
  });
  return child;
}

let guarded = true;

/** Tests turn the guard off: they run no hostile kills. */
export function setGuarded(value: boolean): void {
  guarded = value;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class TimeoutError extends Error {}

/** Runs a program to its end, or stops it after `timeoutMs`. */
export async function runToEnd(
  program: string,
  args: string[],
  timeoutMs: number,
): Promise<RunResult> {
  const child = spawnTracked(program, args);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop(child);
      reject(new TimeoutError(`${program} took too long`));
    }, timeoutMs);
  });
  try {
    const [stdout, stderr, status] = await Promise.race([
      Promise.all([
        readAll(child.stdout),
        readAll(child.stderr, forwardToStderr),
        child.status,
      ]),
      timeout,
    ]);
    return { stdout, stderr, code: status.code };
  } finally {
    clearTimeout(timer);
  }
}

/** A stream's text, handing each chunk to `onChunk` as it comes. */
export async function readAll(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (text: string) => void,
): Promise<string> {
  let text = "";
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    text += chunk;
    onChunk?.(chunk);
  }
  return text;
}

/** Calls `onLine` with each line of `stream`, and resolves at its end. */
export async function forEachLine(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  let pending = "";
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      onLine(pending.substring(0, newline).replace(/\r$/, ""));
      pending = pending.substring(newline + 1);
    }
  }
  if (pending !== "") onLine(pending.replace(/\r$/, ""));
}

const encoder = new TextEncoder();

/** Writes all of `text`, synchronously: nothing is lost if we exit next. */
export function writeAllSync(
  out: { writeSync(p: Uint8Array): number },
  text: string,
): void {
  let bytes = encoder.encode(text);
  while (bytes.length > 0) bytes = bytes.subarray(out.writeSync(bytes));
}

/** yt-dlp's stderr goes to ours, which the app keeps for its log. */
export function forwardToStderr(text: string): void {
  try {
    writeAllSync(Deno.stderr, text);
  } catch {
    // Nobody reading.
  }
}

export function log(message: string): void {
  forwardToStderr(`${message}\n`);
}
