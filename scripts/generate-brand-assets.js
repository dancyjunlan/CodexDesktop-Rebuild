#!/usr/bin/env node
/** Build package icon containers from the supplied AIGeek logo. */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const branding = require(path.join(projectRoot, "branding.json"));

function iconPath(name) {
  const configuredPath = branding.icons?.[name];
  if (typeof configuredPath !== "string" || configuredPath.length === 0) {
    throw new Error(`branding.json: icons.${name} must be a non-empty path`);
  }
  return path.resolve(projectRoot, configuredPath);
}

const png512 = fs.readFileSync(iconPath("webview"));
const png256 = fs.readFileSync(iconPath("webviewSmall"));

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

fs.copyFileSync(iconPath("webview"), iconPath("linux"));
fs.writeFileSync(iconPath("windows"), createIco(png256));
fs.writeFileSync(iconPath("macos"), createIcns(png512));
console.log("[ok] generated AIGeek PNG, ICO, and ICNS assets");
