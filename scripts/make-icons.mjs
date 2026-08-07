import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A dumbbell: centre bar plus two plates. `inset` shrinks the glyph so
// maskable icons survive the platform's safe-zone crop.
function dumbbell(inset) {
  return (x, y, s) => {
    const u = (s / 32) * inset;
    const cx = s / 2, cy = s / 2;
    const bar = Math.abs(y - cy) <= 2 * u && Math.abs(x - cx) <= 10 * u;
    const plateL = Math.abs(x - (cx - 9 * u)) <= 2.5 * u && Math.abs(y - cy) <= 7 * u;
    const plateR = Math.abs(x - (cx + 9 * u)) <= 2.5 * u && Math.abs(y - cy) <= 7 * u;
    return bar || plateL || plateR ? [245, 245, 245, 255] : [17, 17, 17, 255];
  };
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', png(192, dumbbell(1)));
writeFileSync('public/icon-512.png', png(512, dumbbell(1)));
writeFileSync('public/icon-512-maskable.png', png(512, dumbbell(0.72)));
console.log('Wrote public/icon-192.png, icon-512.png, icon-512-maskable.png');
