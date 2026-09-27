// Protocol 1 of the booth's source extensions: the app runs
// `<command> <args…> <verb> <request>`, where the request is one JSON object
// as a single argument, and reads JSON objects from our stdout, one per
// line. stdin is empty. Every request carries `"protocol": 1` and `"data"`,
// a folder we may keep things in.
import { isObject } from "./tracks.ts";

export const protocolVersion = 1;
export type Verb = "resolve" | "fetch";

export interface Invocation {
  verb: Verb;
  /** The request, parsed but not yet checked against the verb. */
  request: unknown;
  /** Path of yt-dlp (`--yt-dlp {dep:yt-dlp}` in the manifest). */
  ytDlp?: string;
}

export class UsageError extends Error {}

/**
 * The request is the last argument and the verb the one before it; the
 * manifest's own arguments come first.
 */
export function parseArgs(args: string[]): Invocation {
  const last = args.at(-1);
  if (args.length < 2 || last === "resolve" || last === "fetch") {
    throw new UsageError("Expected a verb and a request as the last arguments");
  }
  const verb = args[args.length - 2];
  if (verb !== "resolve" && verb !== "fetch") {
    throw new UsageError(`Unknown verb: ${verb}`);
  }
  let request: unknown;
  try {
    request = JSON.parse(args[args.length - 1]);
  } catch {
    throw new UsageError("The request is not JSON");
  }
  const invocation: Invocation = { verb, request };
  const options = args.slice(0, -2);
  for (let i = 0; i < options.length; i++) {
    const arg = options[i];
    if (arg === "--yt-dlp" && i + 1 < options.length) {
      invocation.ytDlp = options[++i];
    } else if (arg.startsWith("--yt-dlp=")) {
      invocation.ytDlp = arg.substring("--yt-dlp=".length);
    }
    // Anything else is left for later versions of the manifest.
  }
  return invocation;
}

interface Common {
  /** A folder the extension may keep things in, when the app gave one. */
  data?: string;
}

export interface ResolveRequest extends Common {
  url: string;
}

export interface FetchRequest extends Common {
  source: string;
  directory: string;
  name: string;
  trusted: boolean;
}

function common(json: unknown): Record<string, unknown> & Common {
  if (!isObject(json)) throw new UsageError("The request is not an object");
  if (json["protocol"] !== protocolVersion) {
    throw new UsageError(
      `Protocol ${JSON.stringify(json["protocol"])} is not supported, ` +
        `this extension speaks ${protocolVersion}`,
    );
  }
  const data = json["data"];
  return {
    ...json,
    data: typeof data === "string" && data !== "" ? data : undefined,
  };
}

export function parseResolveRequest(json: unknown): ResolveRequest {
  const request = common(json);
  if (typeof request["url"] !== "string") {
    throw new UsageError("The request has no url");
  }
  return { url: request["url"], data: request.data };
}

export function parseFetchRequest(json: unknown): FetchRequest {
  const request = common(json);
  const { source, directory, name, trusted, data } = request;
  if (typeof source !== "string" || source === "") {
    throw new UsageError("The request has no source");
  }
  if (typeof directory !== "string" || directory === "") {
    throw new UsageError("The request has no directory");
  }
  // The name is a file name in the directory, never a path out of it.
  if (
    typeof name !== "string" || name === "" || /[\\/]/.test(name) ||
    name === "." || name === ".."
  ) {
    throw new UsageError("The request's name is not a file name");
  }
  // Not said is not trusted.
  return { source, directory, name, trusted: trusted === true, data };
}

/**
 * Only what this extension itself would hand out as a source: web links,
 * and the `ytsearch1:` YouTube searches Spotify songs become (older Roscord
 * clients queued both as they are). A source from another client's booth
 * state names what a new DJ fetches, and must not point it anywhere else:
 * no other search or extractor prefixes, no addresses or local names.
 * Untrusted sources must be https; the app also refuses untrusted links to
 * hosts that resolve to private addresses before asking us.
 */
export function isFetchable(source: string, trusted: boolean): boolean {
  if (source.startsWith("ytsearch1:")) return source.trim().length > 10;
  if (!/^https?:\/\//i.test(source)) return false;
  let uri: URL;
  try {
    uri = new URL(source);
  } catch {
    return false;
  }
  if (uri.protocol !== "https:" && !(trusted && uri.protocol === "http:")) {
    return false;
  }
  if (uri.username !== "" || uri.password !== "") return false;
  const host = uri.hostname.toLowerCase();
  // No addresses: a link names a site, not a machine on someone's network.
  // Resolvers read forms like 127.1 or 0x7f.1 as addresses too.
  return host !== "" &&
    !host.startsWith("[") &&
    !/^[0-9a-fx.]+$/.test(host) &&
    host !== "localhost" &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".local") &&
    !host.endsWith(".internal") &&
    host.includes(".");
}
