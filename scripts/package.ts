// Builds dist/yt-dlp-source.zip: the manifest at the root, next to
// main.ts, src/ and the license. No dependencies: a small zip writer on
// Deno's built-in deflate. Timestamps are fixed so the same sources give the
// same zip.
//
//   deno run --allow-read --allow-write scripts/package.ts

const root = new URL("../", import.meta.url);

async function files(): Promise<string[]> {
  const names = ["roscord-extension.json", "main.ts", "LICENSE", "README.md"];
  const src: string[] = [];
  for await (const entry of Deno.readDir(new URL("src/", root))) {
    if (entry.isFile && entry.name.endsWith(".ts")) {
      src.push(`src/${entry.name}`);
    }
  }
  return [...names, ...src.sort()];
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 1980-01-01 00:00, the earliest DOS date.
const dosTime = 0;
const dosDate = (1 << 5) | 1;

export async function zip(
  entries: { name: string; data: Uint8Array }[],
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name);
    const compressed = await deflate(data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 8, true); // deflate
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressed.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, compressed);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, (3 << 8) | 20, true); // made by: Unix, 2.0
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, 8, true);
    header.setUint16(12, dosTime, true);
    header.setUint16(14, dosDate, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, compressed.length, true);
    header.setUint32(24, data.length, true);
    header.setUint16(28, nameBytes.length, true);
    header.setUint32(38, (0o100644 << 16) >>> 0, true); // -rw-r--r--
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

if (import.meta.main) {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("roscord-extension.json", root)),
  );
  // CI picks the release's version (see .github/workflows/ci.yml) and it
  // replaces the manifest's in the zip. Without one, the manifest's stands.
  const tag = Deno.env.get("RELEASE_TAG");
  const version = tag === undefined ? manifest.version : tag.replace(/^v/, "");
  if (typeof version !== "string" || !/^[0-9A-Za-z.+-]+$/.test(version)) {
    throw new Error(`Bad version: ${version}`);
  }
  manifest.version = version;
  const entries = [];
  for (const name of await files()) {
    const data = name === "roscord-extension.json"
      ? new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n")
      : await Deno.readFile(new URL(name, root));
    entries.push({ name, data });
  }
  await Deno.mkdir(new URL("dist/", root), { recursive: true });
  // No version in the name, so .../releases/latest/download/yt-dlp-source.zip
  // always gets the newest, and installing again from that link updates it.
  // Not `yt-dlp.zip`, which would pass for one of yt-dlp's own.
  const out = new URL("dist/yt-dlp-source.zip", root);
  await Deno.writeFile(out, await zip(entries));
  console.log(`${out.pathname} (${entries.map((e) => e.name).join(", ")})`);
}
