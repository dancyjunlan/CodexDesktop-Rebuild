#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const appDirectory = path.join(root, "out", "win", "AIGeek-win-x64");
const outputDirectory = path.join(root, "out", "installer", "win-x64");
const iconPath = path.join(root, "resources", "forgecode.ico");
const installerScript = path.join(root, "resources", "aigeek-installer.nsi");
const nsis = [
  path.join(process.env.ProgramFiles || "C:\\Program Files", "NSIS", "makensis.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "NSIS", "Bin", "makensis.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "NSIS", "makensis.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "NSIS", "Bin", "makensis.exe"),
].find((candidate) => fs.existsSync(candidate));

if (!fs.existsSync(path.join(appDirectory, "AIGeek.exe"))) {
  throw new Error("Windows app output is missing. Run npm run build:win-x64 first.");
}
if (!nsis) {
  throw new Error("NSIS was not found. Install it with: winget install NSIS.NSIS");
}
if (!fs.existsSync(installerScript)) throw new Error("NSIS installer script is missing.");

fs.mkdirSync(outputDirectory, { recursive: true });
const installerPath = path.join(outputDirectory, "AIGeek-Setup.exe");
execFileSync(nsis, [
  "/V2",
  `/DAPPDIR=${appDirectory}`,
  `/DOUTFILE=${installerPath}`,
  `/DICON=${iconPath}`,
  installerScript,
], { stdio: "inherit" });
console.log(`[installer] created ${installerPath}`);
