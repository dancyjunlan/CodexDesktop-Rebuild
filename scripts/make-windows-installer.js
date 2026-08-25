#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  PROJECT_ROOT,
  branding,
  iconPath,
  windowsExecutableBaseName,
} = require("./branding-config");

const root = PROJECT_ROOT;
const windowsBranding = branding.windows;
const appDirectory = path.join(root, "out", "win", `${windowsExecutableBaseName()}-win-x64`);
const outputDirectory = path.join(root, "out", "installer", "win-x64");
const windowsIconPath = iconPath("windows");
const installerScript = path.join(root, "resources", "aigeek-installer.nsi");
const defaultAuthPath = path.join(root, "auth.json");
const defaultConfigPath = path.join(root, "config.toml");
const dataPath = path.join(root, branding.dataDirectoryName);
const toolsPath = path.join(root, branding.toolsDirectoryName);
const packageVersion = require(path.join(root, "package.json")).version;
const sevenZipDirectory = path.join(root, "node_modules", "electron-winstaller", "vendor");
const sevenZip = path.join(sevenZipDirectory, "7z.exe");
const sevenZipDll = path.join(sevenZipDirectory, "7z.dll");
const compressionThreads = process.env.AIGEEK_BUILD_THREADS || "on";
const showCompressionProgress = windowsBranding.showInstallerCompressionProgress;
const HOME_TOOLS_TOKEN = "__BRANDING_HOME_TOOLS__";
const nsis = [
  path.join(process.env.ProgramFiles || "C:\\Program Files", "NSIS", "makensis.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "NSIS", "Bin", "makensis.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "NSIS", "makensis.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "NSIS", "Bin", "makensis.exe"),
].find((candidate) => fs.existsSync(candidate));

if (!fs.existsSync(path.join(appDirectory, windowsBranding.executableName))) {
  throw new Error("Windows app output is missing. Run npm run build:win-x64 first.");
}
if (!nsis) {
  throw new Error("NSIS was not found. Install it with: winget install NSIS.NSIS");
}
if (!fs.existsSync(installerScript)) throw new Error("NSIS installer script is missing.");
if (!fs.existsSync(defaultAuthPath) || !fs.existsSync(defaultConfigPath)) {
  throw new Error("Default auth.json and config.toml must exist in the project root.");
}
if (!fs.existsSync(dataPath) || !fs.statSync(dataPath).isDirectory()) {
  throw new Error(`Bundled data directory is missing: ${branding.dataDirectoryName}`);
}
if (!fs.existsSync(toolsPath) || !fs.statSync(toolsPath).isDirectory()) {
  throw new Error(`Bundled tools directory is missing: ${branding.toolsDirectoryName}`);
}
if (!fs.existsSync(sevenZip) || !fs.existsSync(sevenZipDll)) {
  throw new Error("Bundled 7-Zip is missing. Run npm install before building the installer.");
}
if (!/^(on|off|\d+)$/i.test(compressionThreads)) {
  throw new Error("AIGEEK_BUILD_THREADS must be 'on', 'off', or a positive number.");
}
if (typeof showCompressionProgress !== "boolean") {
  throw new Error("branding.json: windows.showInstallerCompressionProgress must be a boolean");
}

fs.mkdirSync(outputDirectory, { recursive: true });
const installerFile = path.parse(windowsBranding.installerFileName);
const installerPath = path.join(outputDirectory, windowsBranding.installerFileName);
const stagingPath = path.join(outputDirectory, `${installerFile.name}.building${installerFile.ext}`);
const payloadPath = path.join(outputDirectory, `${installerFile.name}-payload.7z`);
const payloadStagingPath = path.join(outputDirectory, `${installerFile.name}-payload.building.7z`);
const preparedConfigPath = path.join(outputDirectory, `${installerFile.name}-default-config.toml`);
const preparedInstallerScriptPath = path.join(outputDirectory, `${installerFile.name}-script.building.nsi`);
fs.rmSync(stagingPath, { force: true });
fs.rmSync(payloadStagingPath, { force: true });
fs.rmSync(preparedInstallerScriptPath, { force: true });

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTomlKeyInSection(source, sectionName, key, value) {
  const header = `[mcp_servers.${sectionName}]`;
  const sectionStart = source.indexOf(header);
  if (sectionStart === -1) {
    throw new Error(`Config section is missing: ${header}`);
  }

  const nextSection = source.indexOf("\n[", sectionStart + header.length);
  const sectionEnd = nextSection === -1 ? source.length : nextSection;
  const section = source.slice(sectionStart, sectionEnd);
  const keyPattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, "m");
  if (!keyPattern.test(section)) {
    throw new Error(`Config key is missing: ${header}.${key}`);
  }

  const tomlLine = `${key} = "${value}"`;
  const updatedSection = section.replace(keyPattern, (match) =>
    tomlLine + (match.endsWith("\r") ? "\r" : ""),
  );
  return source.slice(0, sectionStart) + updatedSection + source.slice(sectionEnd);
}

function prepareDefaultConfig() {
  const mcp = branding.bundledMcpServer;
  const toTomlPath = (relativePath) => `${HOME_TOOLS_TOKEN}\\\\${relativePath.replaceAll("\\", "\\\\")}`;
  let config = fs.readFileSync(defaultConfigPath, "utf-8");
  config = replaceTomlKeyInSection(
    config,
    mcp.section,
    "command",
    toTomlPath(mcp.commandPath),
  );
  config = replaceTomlKeyInSection(
    config,
    mcp.section,
    "cwd",
    toTomlPath(mcp.cwdPath),
  );
  fs.writeFileSync(preparedConfigPath, config, "utf-8");
}

function prepareInstallerScript() {
  const source = fs.readFileSync(installerScript, "utf-8");
  fs.writeFileSync(preparedInstallerScriptPath, `\uFEFF${source}`, "utf-8");
}

prepareDefaultConfig();

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
  showCompressionProgress ? "-bsp1" : "-bsp0",
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
try {
  prepareInstallerScript();
  execFileSync(nsis, [
    "/V2",
    `/DAPPDIR=${appDirectory}`,
    `/DPAYLOAD=${payloadPath}`,
    `/DSEVENZIP=${sevenZip}`,
    `/DSEVENZIP_DLL=${sevenZipDll}`,
    `/DDEFAULT_AUTH=${defaultAuthPath}`,
    `/DDEFAULT_CONFIG=${preparedConfigPath}`,
    `/DDATA=${dataPath}`,
    `/DTOOLS=${toolsPath}`,
    `/DTOOLS_DIRECTORY_NAME=${branding.toolsDirectoryName}`,
    `/DPRODUCT_VERSION=${packageVersion}`,
    `/DPRODUCT_NAME=${branding.appName}`,
    `/DPRODUCT_PUBLISHER=${branding.author}`,
    `/DAPP_USER_MODEL_ID=${windowsBranding.appUserModelId}`,
    `/DHOME_DIRECTORY_NAME=${branding.homeDirectoryName}`,
    `/DEXECUTABLE_NAME=${windowsBranding.executableName}`,
    `/DLEGACY_PRODUCT_NAME=${windowsBranding.legacyProductName || ""}`,
    `/DOUTFILE=${stagingPath}`,
    `/DICON=${windowsIconPath}`,
    preparedInstallerScriptPath,
  ], { stdio: "inherit" });
} finally {
  fs.rmSync(preparedInstallerScriptPath, { force: true });
}
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
  completedInstallerPath = path.join(outputDirectory, `${installerFile.name}-${packageVersion}${installerFile.ext}`);
  fs.rmSync(completedInstallerPath, { force: true });
  fs.renameSync(stagingPath, completedInstallerPath);
  console.warn(`[installer] ${path.basename(installerPath)} is in use; created ${path.basename(completedInstallerPath)} instead.`);
}
console.log(`[installer] created ${completedInstallerPath}`);
