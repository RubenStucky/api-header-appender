const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// Background gradients per state
const backgrounds = {
  inactive: { top: [59, 130, 246], bot: [29, 78, 216] },     // Blue
  active:   { top: [34, 197, 94],  bot: [22, 163, 74] },     // Green
  pending:  { top: [245, 158, 11], bot: [217, 119, 6] },     // Orange/Amber
};

function createLockPNG(size, state) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc(size * (1 + size * 4));
  const s = size;
  const cx = s / 2;

  const cornerR = Math.max(Math.floor(s * 0.15), 2);

  function inRoundedRect(x, y, x1, y1, x2, y2, r) {
    if (x < x1 || x > x2 || y < y1 || y > y2) return false;
    const dx = (x < x1 + r) ? x - (x1 + r) : (x > x2 - r) ? x - (x2 - r) : 0;
    const dy = (y < y1 + r) ? y - (y1 + r) : (y > y2 - r) ? y - (y2 - r) : 0;
    return dx * dx + dy * dy <= r * r;
  }

  const bodyL = s * 0.22;
  const bodyR = s * 0.78;
  const bodyT = s * 0.45;
  const bodyB = s * 0.85;
  const bodyCorner = Math.max(Math.floor(s * 0.08), 1);

  const shackleOuterR = s * 0.22;
  const shackleInnerR = s * 0.13;
  const shackleCy = s * 0.38;
  const shackleCxClosed = cx;
  const shackleCxOpen = cx + s * 0.12;
  const shackleCyOpen = shackleCy - s * 0.08;

  const keyholeY = s * 0.60;
  const keyholeR = s * 0.06;
  const keySlotH = s * 0.10;
  const keySlotW = s * 0.035;

  const isOpen = state === 'inactive';

  function isLockPixel(x, y) {
    if (inRoundedRect(x, y, bodyL, bodyT, bodyR, bodyB, bodyCorner)) {
      if (dist(x, y, cx, keyholeY) <= keyholeR) return false;
      if (x >= cx - keySlotW && x <= cx + keySlotW && y >= keyholeY && y <= keyholeY + keySlotH) return false;
      return true;
    }

    const scx = isOpen ? shackleCxOpen : shackleCxClosed;
    const scy = isOpen ? shackleCyOpen : shackleCy;

    if (y <= scy) {
      const d = dist(x, y, scx, scy);
      if (d <= shackleOuterR && d >= shackleInnerR) return true;
    } else {
      const leftBarX = scx - shackleOuterR;
      if (x >= leftBarX && x <= leftBarX + (shackleOuterR - shackleInnerR) && y <= bodyT + 1) {
        return true;
      }
      if (!isOpen) {
        const rightBarX = scx + shackleInnerR;
        if (x >= rightBarX && x <= scx + shackleOuterR && y <= bodyT + 1) {
          return true;
        }
      }
    }

    return false;
  }

  function sampleLock(x, y) {
    let hits = 0;
    const sub = 4;
    for (let sy = 0; sy < sub; sy++) {
      for (let sx = 0; sx < sub; sx++) {
        if (isLockPixel(x + (sx + 0.5) / sub, y + (sy + 0.5) / sub)) hits++;
      }
    }
    return hits / (sub * sub);
  }

  const bg = backgrounds[state];

  for (let y = 0; y < s; y++) {
    const rowOffset = y * (1 + s * 4);
    rawData[rowOffset] = 0;
    const t = y / (s - 1 || 1);
    const bgR = Math.round(bg.top[0] + (bg.bot[0] - bg.top[0]) * t);
    const bgG = Math.round(bg.top[1] + (bg.bot[1] - bg.top[1]) * t);
    const bgB = Math.round(bg.top[2] + (bg.bot[2] - bg.top[2]) * t);

    for (let x = 0; x < s; x++) {
      const px = rowOffset + 1 + x * 4;

      if (!inRoundedRect(x, y, 0, 0, s - 1, s - 1, cornerR)) {
        rawData[px] = 0; rawData[px + 1] = 0; rawData[px + 2] = 0; rawData[px + 3] = 0;
        continue;
      }

      const coverage = sampleLock(x, y);

      if (coverage > 0) {
        rawData[px] = Math.round(255 * coverage + bgR * (1 - coverage));
        rawData[px + 1] = Math.round(255 * coverage + bgG * (1 - coverage));
        rawData[px + 2] = Math.round(255 * coverage + bgB * (1 - coverage));
        rawData[px + 3] = 255;
      } else {
        rawData[px] = bgR; rawData[px + 1] = bgG; rawData[px + 2] = bgB; rawData[px + 3] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

const states = ['inactive', 'active', 'pending'];
const sizes = [16, 48, 128];

for (const state of states) {
  for (const size of sizes) {
    fs.writeFileSync(__dirname + `/icon-${state}-${size}.png`, createLockPNG(size, state));
  }
}

// Default icons = inactive
for (const size of sizes) {
  fs.writeFileSync(__dirname + `/icon-${size}.png`, createLockPNG(size, 'inactive'));
}

console.log('Lock icons created: inactive (blue), active (green), pending (orange) at 16/48/128px');
