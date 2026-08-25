#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const branding = require(path.join(root, "branding.json"));
const appDirectory = path.join(root, "out", "win", "AIGeek-win-x64");
const outputDirectory = path.join(root, "out", "installer", "win-x64");
const iconPath = path.resolve(root, branding.icons.windows);
const installerScript = path.join(root, "resources", "aigeek-installer.nsi");
const defaultAuthPath = path.join(root, "auth.json");
const defaultConfigPath = path.join(root, "config.toml");
const packageVersion = require(path.join(root, "package.json")).version;
const sevenZipDirectory = path.join(root, "node_modules", "electron-winstaller", "vendor");
const sevenZip = path.join(sevenZipDirectory, "7z.exe");
const sevenZipDll = path.join(sevenZipDirectory, "7z.dll");
const compressionThreads = process.env.AIGEEK_BUILD_THREADS || "on";
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
if (!fs.existsSync(defaultAuthPath) || !fs.existsSync(defaultConfigPath)) {
  throw new Error("Default auth.json and config.toml must exist in the project root.");
}
if (!fs.existsSync(sevenZip) || !fs.existsSync(sevenZipDll)) {
  throw new Error("Bundled 7-Zip is missing. Run npm install before building the installer.");
}
if (!/^(on|off|\d+)$/i.test(compressionThreads)) {
  throw new Error("AIGEEK_BUILD_THREADS must be 'on', 'off', or a positive number.");
}

fs.mkdirSync(outputDirectory, { recursive: true });
const installerPath = path.join(outputDirectory, "AIGeek-Setup.exe");
const stagingPath = path.join(outputDirectory, "AIGeek-Setup.building.exe");
const payloadPath = path.join(outputDirectory, "AIGeek-payload.7z");
const payloadStagingPath = path.join(outputDirectory, "AIGeek-payload.building.7z");
fs.rmSync(stagingPath, { force: true });
fs.rmSync(payloadStagingPath, { force: true });

// LZMA2 allows 7-Zip to compress the large Chromium payload on several CPU
// threads. Disabling solid mode creates independent blocks, so the many
// Chromium files can actually use those threads. NSIS then stores that archive
// without trying to recompress it.
console.log(`[installer] compressing app payload with LZMA2 (${compressionThreads === "on" ? "all CPU threads" : `${compressionThreads} threads`})...`);
execFileSync(sevenZip, [
  "a",
  "-t7z",
  "-m0=LZMA2",
  "-mx=5",
  `-mmt=${compressionThreads}`,
  "-ms=off",
  "-bsp0",
  payloadStagingPath,
  ".\\*",
], { cwd: appDirectory, stdio: "inherit" });
if (!fs.existsSync(payloadStagingPath) || fs.statSync(payloadStagingPath).size === 0) {
  throw new Error("7-Zip did not produce a completed application payload.");
}
fs.rmSync(payloadPath, { force: true });
fs.renameSync(payloadStagingPath, payloadPath);

// NSIS writes its checksum only after compilation completes. Build to a
// staging filename so the public installer path can never be a half-written
// executable that reports an integrity error when opened during a build.
console.log("[installer] wrapping compressed payload with NSIS...");
execFileSync(nsis, [
  "/V2",
  `/DAPPDIR=${appDirectory}`,
  `/DPAYLOAD=${payloadPath}`,
  `/DSEVENZIP=${sevenZip}`,
  `/DSEVENZIP_DLL=${sevenZipDll}`,
  `/DDEFAULT_AUTH=${defaultAuthPath}`,
  `/DDEFAULT_CONFIG=${defaultConfigPath}`,
  `/DPRODUCT_VERSION=${packageVersion}`,
  `/DAPP_USER_MODEL_ID=${branding.windowsAppUserModelId}`,
  `/DOUTFILE=${stagingPath}`,
  `/DICON=${iconPath}`,
  installerScript,
], { stdio: "inherit" });
if (!fs.existsSync(stagingPath) || fs.statSync(stagingPath).size === 0) {
  throw new Error("NSIS did not produce a completed installer.");
}
let completedInstallerPath = installerPath;
try {
  fs.rmSync(installerPath, { force: true });
  fs.renameSync(stagingPath, installerPath);
} catch (error) {
  // Windows does not allow an opened installer to be replaced. Keep the
  // completed build available under a versioned name instead of failing after
  // all compression work has already finished.
  if (!fs.existsSync(stagingPath)) throw error;
  completedInstallerPath = path.join(outputDirectory, `AIGeek-Setup-${packageVersion}.exe`);
  fs.rmSync(completedInstallerPath, { force: true });
  fs.renameSync(stagingPath, completedInstallerPath);
  console.warn(`[installer] ${path.basename(installerPath)} is in use; created ${path.basename(completedInstallerPath)} instead.`);
}
console.log(`[installer] created ${completedInstallerPath}`);
