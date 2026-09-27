// Keeps yt-dlp current, at most once a day: YouTube changes break older ones.
//
// One process runs per request and exits when its answer is out, so the
// update can't simply run alongside in this process. It is started as a
// detached `yt-dlp -U` that is left to finish on its own, and never waited
// for: a request neither slows down nor fails because of it. yt-dlp's
// updater swaps the program in with a rename, so a request running the old
// one at the same time is not disturbed.
//
// The day is claimed (the timestamp written) before the update starts, so
// the several requests the booth starts at once for a queue run one update,
// not one each. A failed update is tried again the next day.
import { log } from "./process.ts";

const day = 24 * 60 * 60 * 1000;
export const stampName = "yt-dlp-last-update";

/** Whether an update is due, given the stamp file's text (null: none). */
export function updateDue(stamp: string | null, now: number): boolean {
  if (stamp === null) return true;
  const last = Number(stamp.trim());
  if (!Number.isFinite(last)) return true;
  // A clock set back makes a stamp from the future; don't wait for it.
  return now - last >= day || last > now + day;
}

/** Starts a daily update in the background if one is due. Never throws. */
export async function updateInBackground(
  ytDlp: string,
  dataDir: string | undefined,
  now = Date.now(),
): Promise<void> {
  if (dataDir === undefined || dataDir === "") return;
  try {
    const stampPath = `${dataDir.replace(/[\\/]+$/, "")}/${stampName}`;
    let stamp: string | null = null;
    try {
      stamp = await Deno.readTextFile(stampPath);
    } catch {
      // Never updated.
    }
    if (!updateDue(stamp, now)) return;
    await Deno.mkdir(dataDir, { recursive: true });
    await Deno.writeTextFile(stampPath, String(now));
    const child = new Deno.Command(ytDlp, {
      args: ["-U"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
      detached: true,
    }).spawn();
    child.unref();
    log(`yt-dlp: checking for an update in the background (pid ${child.pid})`);
  } catch (e) {
    log(`yt-dlp: could not start an update: ${e}`);
  }
}
