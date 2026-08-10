#!/usr/bin/env node
/** Create PNG, ICO, and ICNS variants of the ForgeCode mark without extra dependencies. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUTPUT = path.join(__dirname, "..", "resources");
const COLORS = { background: [23, 35, 31, 255], mint: [110, 231, 193, 255], coral: [255, 122, 89, 255] };

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const intersect = ((a[1] > y) !== (b[1] > y)) && (x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]);
    if (intersect) inside = !inside;
  }
  return inside;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 512;
  const shapes = [
    { color: COLORS.mint, points: [[110, 104], [228, 104], [286, 168], [228, 230], [170, 230], [170, 408], [110, 366]] },
    { color: COLORS.coral, points: [[228, 104], [408, 104], [408, 172], [280, 172]] },
    { color: COLORS.coral, points: [[228, 224], [360, 224], [360, 288], [228, 288]] },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const originalX = (x + 0.5) / scale, originalY = (y + 0.5) / scale;
      let color = COLORS.background;
      for (const shape of shapes) if (pointInPolygon(originalX, originalY, shape.points)) color = shape.color;
      const offset = (y * size + x) * 4;
      pixels.set(color, offset);
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

function createIcns(png) {
  const chunkLength = png.length + 8;
  const iconChunk = Buffer.alloc(chunkLength);
  iconChunk.write("ic08", 0, "ascii");
  iconChunk.writeUInt32BE(chunkLength, 4);
  png.copy(iconChunk, 8);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(header.length + iconChunk.length, 4);
  return Buffer.concat([header, iconChunk]);
}

const png512 = render(512);
const png256 = render(256);
fs.writeFileSync(path.join(OUTPUT, "forgecode.png"), png512);
fs.writeFileSync(path.join(OUTPUT, "forgecode.ico"), createIco(png256));
fs.writeFileSync(path.join(OUTPUT, "forgecode.icns"), createIcns(png512));
console.log("[ok] generated ForgeCode PNG, ICO, and ICNS assets");
