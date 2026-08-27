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
const { prepareHomeConfig } = require("./prepare-home-config");

const root = PROJECT_ROOT;
const windowsBranding = branding.windows;
const appDirectory = path.join(root, "out", "win", `${windowsExecutableBaseName()}-win-x64`);
const outputDirectory = path.join(root, "out", "installer", "win-x64");
const windowsIconPath = iconPath("windows");
const installerScript = path.join(root, "resources", "aigeek-installer.nsi");
const packageVersion = require(path.join(root, "package.json")).version;
const homeSeedPath = path.join(
  appDirectory,
  "resources",
  branding.homeInitialization.resourceDirectoryName,
);
const sevenZipDirectory = path.join(root, "node_modules", "electron-winstaller", "vendor");
const sevenZip = path.join(sevenZipDirectory, "7z.exe");
const sevenZipDll = path.join(sevenZipDirectory, "7z.dll");
const compressionThreads = process.env.AIGEEK_BUILD_THREADS || "on";
const showCompressionProgress = windowsBranding.showInstallerCompressionProgress;
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

function syncHomeSeedAssets() {
  const sourcePaths = {
    data: path.join(root, branding.dataDirectoryName),
    tools: path.join(root, branding.toolsDirectoryName),
    auth: path.join(root, branding.homeInitialization.authFileName),
    config: path.join(root, branding.homeInitialization.configFileName),
    aclScript: path.join(root, "resources", branding.homeInitialization.aclScriptFileName),
  };
  for (const [name, sourcePath] of Object.entries(sourcePaths)) {
    const expectedType = name === "data" || name === "tools" ? "directory" : "file";
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Windows home initialization ${expectedType} is missing: ${sourcePath}`);
    }
    if (expectedType === "directory" && !fs.statSync(sourcePath).isDirectory()) {
      throw new Error(`Windows home initialization source is not a directory: ${sourcePath}`);
    }
  }

  fs.mkdirSync(homeSeedPath, { recursive: true });
  for (const directoryName of [branding.dataDirectoryName, branding.toolsDirectoryName]) {
    const destinationPath = path.join(homeSeedPath, directoryName);
    fs.rmSync(destinationPath, { recursive: true, force: true });
    fs.cpSync(sourcePaths[directoryName], destinationPath, { recursive: true, force: true });
  }
  fs.copyFileSync(sourcePaths.auth, path.join(homeSeedPath, branding.homeInitialization.authFileName));
  prepareHomeConfig({
    sourcePath: sourcePaths.config,
    destinationPath: path.join(homeSeedPath, branding.homeInitialization.configFileName),
    branding,
  });
  fs.copyFileSync(
    sourcePaths.aclScript,
    path.join(homeSeedPath, branding.homeInitialization.aclScriptFileName),
  );
  console.log("[installer] synchronized current home initialization assets");
}

syncHomeSeedAssets();

for (const relativePath of [
  branding.dataDirectoryName,
  branding.toolsDirectoryName,
  branding.homeInitialization.authFileName,
  branding.homeInitialization.configFileName,
  branding.homeInitialization.aclScriptFileName,
]) {
  if (!fs.existsSync(path.join(homeSeedPath, relativePath))) {
    throw new Error(`Windows home initialization asset is missing from app resources: ${relativePath}`);
  }
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
const preparedInstallerScriptPath = path.join(outputDirectory, `${installerFile.name}-script.building.nsi`);
fs.rmSync(stagingPath, { force: true });
fs.rmSync(payloadStagingPath, { force: true });
fs.rmSync(preparedInstallerScriptPath, { force: true });

// Default home configuration is prepared at first launch for each Windows user.

function prepareInstallerScript() {
  const source = fs.readFileSync(installerScript, "utf-8");
  fs.writeFileSync(preparedInstallerScriptPath, `\uFEFF${source}`, "utf-8");
}

function validateRequiredNsisDefinitions(source, args) {
  const suppliedDefinitions = new Set(args.flatMap((argument) => {
    const match = /^\/D([^=]+)=/i.exec(argument);
    return match ? [match[1].toUpperCase()] : [];
  }));
  const requiredDefinitions = [...source.matchAll(
    /^!ifndef[ \t]+([A-Z0-9_]+)[ \t]*\r?\n!error\b/gm,
  )].map((match) => match[1].toUpperCase());
  const missingDefinitions = requiredDefinitions.filter(
    (definition) => !suppliedDefinitions.has(definition),
  );
  if (missingDefinitions.length > 0) {
    throw new Error(
      `NSIS build arguments are missing required definitions: ${missingDefinitions.join(", ")}`,
    );
  }
}

const nsisArguments = [
  "/V2",
  `/DAPPDIR=${appDirectory}`,
  `/DPAYLOAD=${payloadPath}`,
  `/DSEVENZIP=${sevenZip}`,
  `/DSEVENZIP_DLL=${sevenZipDll}`,
  `/DPRODUCT_VERSION=${packageVersion}`,
  `/DPRODUCT_NAME=${branding.appName}`,
  `/DPRODUCT_PUBLISHER=${branding.author}`,
  `/DAPP_USER_MODEL_ID=${windowsBranding.appUserModelId}`,
  `/DEXECUTABLE_NAME=${windowsBranding.executableName}`,
  `/DLEGACY_PRODUCT_NAME=${windowsBranding.legacyProductName || ""}`,
  `/DOUTFILE=${stagingPath}`,
  `/DICON=${windowsIconPath}`,
  preparedInstallerScriptPath,
];

validateRequiredNsisDefinitions(
  fs.readFileSync(installerScript, "utf-8"),
  nsisArguments,
);
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
  execFileSync(nsis, nsisArguments, { stdio: "inherit" });
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
