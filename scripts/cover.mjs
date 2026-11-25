// Generates cover.png (800x534) for gladys-drop: plain Node, no dependency.
// A large water drop over a pipe with a shutoff valve, a hub publishing to a
// local broker (waves), a softener tank and a flow gauge, on a teal gradient
// (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [10 + 14 * t, 60 + 50 * t, 78 + 50 * t]);
  }
}
const white = [255, 255, 255];
const steel = [190, 205, 220];
const dark = [20, 38, 66];
const water = [90, 180, 255];
const red = [235, 90, 80];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const rect = (x0, y0, w, h, color, alpha = 1) => {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) set(x, y, color, alpha);
};
const ring = (cx, cy, r, width, color, from, to, alpha = 1) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};

// The pipe across the picture, with a valve in the middle.
rect(0, 380, W, 46, steel);
rect(0, 388, W, 6, white, 0.35);
rect(360, 350, 80, 106, steel);
rect(372, 362, 56, 82, dark);
disc(400, 403, 22, red);
rect(385, 399, 30, 8, white);
// A large drop above the valve.
disc(400, 210, 92, water);
for (let y = 60; y < 210; y += 1) {
  const half = ((y - 60) / 150) * 88;
  for (let x = Math.floor(400 - half); x <= 400 + half; x += 1) set(x, y, water);
}
disc(368, 196, 22, white, 0.35);
// The hub on the left, publishing (waves) to the broker.
rect(90, 230, 120, 90, white);
rect(102, 242, 96, 66, dark);
disc(150, 275, 14, water);
for (const r of [36, 56, 76]) ring(150, 230, r, 6, white, -2.6, -0.55, 0.8);
// A softener tank on the right, and a flow gauge.
rect(600, 200, 90, 170, white);
rect(612, 212, 66, 146, dark);
rect(612, 300, 66, 58, water, 0.9);
disc(645, 470, 40, white);
disc(645, 470, 32, dark);
ring(645, 470, 24, 5, water, -3.1, -0.4);
rect(643, 450, 4, 22, white);

// PNG encoding (RGB, no filter).
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(W, 0);
header.writeUInt32BE(H, 4);
header[8] = 8;
header[9] = 2;
writeFileSync(
  process.argv[2] ?? 'cover.png',
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
