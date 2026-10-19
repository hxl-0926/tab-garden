import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function pngChunk(type, data) {
  const label = Buffer.from(type), body = Buffer.concat([label, data]); let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
function iconPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size), scale = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const px = (x + (sx + .5) / scale) / size, py = (y + (sy + .5) / scale) / size;
      const rounded = Math.hypot(Math.max(Math.abs(px - .5) - .3, 0), Math.max(Math.abs(py - .5) - .3, 0)) <= .17;
      let color = rounded ? [53, 93, 67, 255] : [0, 0, 0, 0];
      const u = (px - .55) * .707 + (py - .43) * -.707, v = (px - .55) * .707 + (py - .43) * .707;
      if ((u / .29) ** 2 + (v / .14) ** 2 < 1) color = [215, 230, 183, 255];
      if (px > .27 && px < .6 && Math.abs(py - (1 - px)) < .018 && py > .43) color = [215, 230, 183, 255];
      for (let i = 0; i < 4; i++) sum[i] += color[i];
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let i = 0; i < 4; i++) raw[offset + i] = Math.round(sum[i] / scale ** 2);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
await mkdir(path.join(root, 'assets'), { recursive: true });
for (const size of [16, 48, 128]) await writeFile(path.join(root, 'assets', `icon-${size}.png`), iconPng(size));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.permissions.some(p => !['tabs', 'storage', 'tabGroups'].includes(p)) || manifest.host_permissions?.length) throw new Error('Unexpected manifest permissions');
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const name of ['app', 'src', 'assets', 'manifest.json', 'LICENSE', 'README.md', 'PRIVACY.md']) await cp(path.join(root, name), path.join(root, 'dist', name), { recursive: true });
for (const icon of Object.values(manifest.icons)) await readFile(path.join(root, 'dist', icon));
const source = await readFile(path.join(root, 'dist', 'app/index.html'), 'utf8');
if (/<script[^>]+src=["']https?:/i.test(source)) throw new Error('Remote script detected');
const files = await readdir(path.join(root, 'dist'));
console.log(`Built Manifest V3 extension in dist/ (${files.length} top-level entries). Load dist/ as an unpacked extension.`);
