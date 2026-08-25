#!/usr/bin/env node
/** Build package icon containers from the configured brand logo. */
const fs = require("fs");
const zlib = require("zlib");
const { branding, iconPath } = require("./branding-config");

const png512 = fs.readFileSync(iconPath("webview"));
const png256 = fs.readFileSync(iconPath("webviewSmall"));

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Keep icon generation dependency-free so branding works before package installation.
function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodePng(png) {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Brand icon must be a PNG image");
  }

  let offset = PNG_SIGNATURE.length;
  let width;
  let height;
  const idat = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    offset += 12 + size;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error("Brand icon PNG must use 8-bit RGBA pixels without interlacing");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || idat.length === 0) {
    throw new Error("Brand icon PNG is missing image data");
  }

  const stride = width * 4;
  const filtered = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset++];
    const rowOffset = y * stride;
    const previousRowOffset = rowOffset - stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[inputOffset++];
      const left = x >= 4 ? pixels[rowOffset + x - 4] : 0;
      const above = y > 0 ? pixels[previousRowOffset + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[previousRowOffset + x - 4] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += Math.floor((left + above) / 2);
      else if (filter === 4) value += paethPredictor(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return result;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, typeBuffer, data, crc32(Buffer.concat([typeBuffer, data]))]);
}

function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function resizeRgba(source, size) {
  if (source.width === size && source.height === size) return source.pixels;
  const pixels = Buffer.alloc(size * size * 4);
  const xScale = source.width / size;
  const yScale = source.height / size;
  for (let y = 0; y < size; y += 1) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < size; x += 1) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const [sampleX, weightX] of [[x0, 1 - xWeight], [x1, xWeight]]) {
        for (const [sampleY, weightY] of [[y0, 1 - yWeight], [y1, yWeight]]) {
          const weight = weightX * weightY;
          const sourceOffset = (sampleY * source.width + sampleX) * 4;
          const sampleAlpha = source.pixels[sourceOffset + 3] / 255;
          alpha += sampleAlpha * weight;
          red += source.pixels[sourceOffset] * sampleAlpha * weight;
          green += source.pixels[sourceOffset + 1] * sampleAlpha * weight;
          blue += source.pixels[sourceOffset + 2] * sampleAlpha * weight;
        }
      }
      const outputOffset = (y * size + x) * 4;
      pixels[outputOffset + 3] = Math.round(alpha * 255);
      if (alpha > 0) {
        pixels[outputOffset] = Math.round(red / alpha);
        pixels[outputOffset + 1] = Math.round(green / alpha);
        pixels[outputOffset + 2] = Math.round(blue / alpha);
      }
    }
  }
  return pixels;
}

function createIco(sourcePng) {
  const source = decodePng(sourcePng);
  const images = ICO_SIZES.map((size) => ({
    size,
    png: encodePng(size, size, resizeRgba(source, size)),
  }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;
  const payload = [];
  images.forEach(({ size, png }, index) => {
    const entryOffset = index * 16;
    entries[entryOffset] = size >= 256 ? 0 : size;
    entries[entryOffset + 1] = size >= 256 ? 0 : size;
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(png.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    payload.push(png);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...payload]);
}

function createIcns(png) {
  const iconChunk = Buffer.alloc(png.length + 8);
  iconChunk.write("ic08", 0, "ascii");
  iconChunk.writeUInt32BE(iconChunk.length, 4);
  png.copy(iconChunk, 8);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(header.length + iconChunk.length, 4);
  return Buffer.concat([header, iconChunk]);
}

fs.copyFileSync(iconPath("webview"), iconPath("linux"));
fs.writeFileSync(iconPath("windows"), createIco(png256));
fs.writeFileSync(iconPath("macos"), createIcns(png512));
console.log(`[ok] generated ${branding.appName} PNG, ICO, and ICNS assets`);
