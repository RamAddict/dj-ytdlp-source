// Ends yt-dlp when the extension process is gone without saying so.
//
// The app kills a request that runs over its time, and on Linux a SIGKILL
// can't be caught: yt-dlp would go on downloading for nobody. So each
// yt-dlp gets this small guard: a separate process whose stdin is a pipe
// from the extension. The extension writes one byte to it once yt-dlp has
// ended normally. If the pipe closes without that byte, the extension died
// first, and the guard ends yt-dlp and everything it started.
//
// Linux only: on Windows the app runs the extension in a job object and ends
// the whole job, and Deno takes its children (this guard too) down with it.
//
// Usage: deno run --allow-run --no-prompt watchdog.ts <yt-dlp pid>

const pid = Number(Deno.args[0]);

async function releasedNormally(): Promise<boolean> {
  const buffer = new Uint8Array(1);
  try {
    // A byte: yt-dlp is done. End of file: the extension is gone.
    return (await Deno.stdin.read(buffer)) !== null;
  } catch {
    return false;
  }
}

if (Number.isInteger(pid) && pid > 0 && !(await releasedNormally())) {
  if (Deno.build.os === "windows") {
    // yt-dlp.exe is a launcher with Python as its child: the whole tree.
    await new Deno.Command("taskkill", {
      args: ["/PID", String(pid), "/T", "/F"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output().catch(() => {});
  } else {
    // SIGTERM, which yt-dlp's launcher passes on to Python; then for sure.
    try {
      Deno.kill(pid, "SIGTERM");
      await new Promise((r) => setTimeout(r, 3000));
      Deno.kill(pid, "SIGKILL");
    } catch {
      // Gone already.
    }
  }
}
