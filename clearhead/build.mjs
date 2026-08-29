// Build step: generate the app icons (indexed-color PNGs, no dependencies)
// and assemble the static output in public/. Runs on Vercel via `npm run build`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';

const PAL = [
  [0x17, 0x12, 0x08], // bg
  [0x84, 0xc8, 0x8b], // green
  [0xeb, 0xa3, 0x3c], // amber
  [0xe4, 0x6a, 0x38], // ember
  [0xe0, 0x4b, 0x55], // red
  [0xf4, 0xea, 0xd6], // cream
];

function render(size, pad = 1.0) {
  const s = size / 512;
  const cx = 256 * s, cy = 312 * s;           // screen coords, y down
  const R = 157 * s * pad, HW = 17.5 * s * pad;
  const bounds = [0.0, 0.30, 0.52, 0.74, 1.0], gap = 0.012;
  const segs = [];
  for (let i = 0; i < 4; i++) {
    const f0 = bounds[i] + (i ? gap : 0), f1 = bounds[i + 1] - (i < 3 ? gap : 0);
    segs.push([Math.PI * (1 - f1), Math.PI * (1 - f0), i + 1]);
  }
  const na = Math.PI * (1 - 0.20);
  const tipx = cx + (R - 6 * s * pad) * Math.cos(na);
  const tipy = cy - (R - 6 * s * pad) * Math.sin(na);
  const nw = 8.5 * s * pad, hub = 29 * s * pad, hole = 12 * s * pad;
  const vx = tipx - cx, vy = tipy - cy, vlen2 = vx * vx + vy * vy;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size);
    const py = y + 0.5;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const dx = px - cx, dyup = cy - py;
      let c = 0;
      const d = Math.hypot(dx, dyup);
      if (Math.abs(d - R) <= HW && dyup > -HW * 1.2) {
        const a = Math.atan2(Math.max(dyup, 0.0001), dx);
        for (const [aLo, aHi, col] of segs) {
          if (a >= aLo && a <= aHi) { c = col; break; }
        }
      }
      const t = Math.max(0, Math.min(1, ((px - cx) * vx + (py - cy) * vy) / vlen2));
      const qx = cx + t * vx, qy = cy + t * vy;
      if (Math.hypot(px - qx, py - qy) <= nw) c = 5;
      if (d <= hub) c = 2;
      if (d <= hole) c = 0;
      row[x] = c;
    }
    rows.push(row);
  }
  return rows;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(rows, path) {
  const size = rows.length;
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])));
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 3; // 8-bit, indexed
  const plte = Buffer.concat(PAL.map((p) => Buffer.from(p)));
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, out);
  console.log(path, out.length, 'bytes');
}

mkdirSync('public', { recursive: true });
png(render(512), 'public/icon-512.png');
png(render(512, 0.74), 'public/icon-mask-512.png');
png(render(192), 'public/icon-192.png');
png(render(180), 'public/apple-touch-icon.png');
// index.html / sw.js / manifest.webmanifest: copy the local files when present
// (normal repo build). When they aren't shipped — a size-limited inline deploy
// carries only this script plus package.json and api/ — fetch the exact same
// bytes from the app's own public repo instead (deploys pin an immutable commit
// SHA here; the repo copy falls back to the working branch).
const { createHash } = await import('node:crypto');
const md5 = (s) => createHash('md5').update(s).digest('hex').slice(0, 12);
const SRC = 'https://raw.githubusercontent.com/vrentch/vrent-dashboard/claude/alcohol-intake-tracker-3sblp4/clearhead/';
async function localOrFetch(f, out) {
  if (existsSync(f)) { copyFileSync(f, out); return readFileSync(f); }
  const r = await fetch(SRC + f);
  if (!r.ok) throw new Error(f + ' fetch failed: ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(out, buf);
  console.log('fetched', f);
  return buf;
}
const html = await localOrFetch('index.html', 'public/index.html');
await localOrFetch('sw.js', 'public/sw.js');
await localOrFetch('manifest.webmanifest', 'public/manifest.webmanifest');
console.log('index.html', html.length, 'bytes, md5', md5(html.toString('binary')));
console.log('api md5', md5(readFileSync('api/clearhead.ts', 'utf8')));
console.log('build done');
