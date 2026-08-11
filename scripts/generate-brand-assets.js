#!/usr/bin/env node
/** Build package icon containers from the supplied AIGeek logo. */
const fs = require("fs");
const path = require("path");

const output = path.join(__dirname, "..", "resources");
const png512 = fs.readFileSync(path.join(output, "aigeek-mark.png"));
const png256 = fs.readFileSync(path.join(output, "aigeek-mark-256.png"));

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
  const iconChunk = Buffer.alloc(png.length + 8);
  iconChunk.write("ic08", 0, "ascii");
  iconChunk.writeUInt32BE(iconChunk.length, 4);
  png.copy(iconChunk, 8);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(header.length + iconChunk.length, 4);
  return Buffer.concat([header, iconChunk]);
}

fs.copyFileSync(path.join(output, "aigeek-mark.png"), path.join(output, "forgecode.png"));
fs.writeFileSync(path.join(output, "forgecode.ico"), createIco(png256));
fs.writeFileSync(path.join(output, "forgecode.icns"), createIcns(png512));
console.log("[ok] generated AIGeek PNG, ICO, and ICNS assets");
