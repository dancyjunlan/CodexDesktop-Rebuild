#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { branding } = require("./branding-config");
const {
  HOME_TOOLS_TOKEN,
  appendMissingMcpServerConfig,
  prepareHomeConfigText,
} = require("./prepare-home-config");

const projectRoot = path.resolve(__dirname, "..");
const home = os.homedir();
const sourceDir = path.join(home, ".forgecode");
const targetDir = path.join(home, branding.homeDirectoryName);

fs.mkdirSync(targetDir, { recursive: true });

function copyTreeMissing(source, target) {
  if (!fs.existsSync(source)) return 0;
  let copied = 0;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copied += copyTreeMissing(sourcePath, targetPath);
    } else if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      copied += 1;
    }
  }
  return copied;
}

function replaceTreeIfOlder(source, target) {
  if (!fs.existsSync(source)) return false;
  if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs) {
    return false;
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  return true;
}

const projectToolsDirectory = path.join(projectRoot, branding.toolsDirectoryName);
const targetToolsDirectory = path.join(targetDir, branding.toolsDirectoryName);
const packageSource = path.join(projectToolsDirectory, branding.bundledMcpServer.cwdPath);
const packageTarget = path.join(targetToolsDirectory, branding.bundledMcpServer.cwdPath);
if (replaceTreeIfOlder(packageSource, packageTarget)) {
  console.log(`[branding-home] synchronized ${branding.toolsDirectoryName}/${branding.bundledMcpServer.cwdPath}`);
}

for (const directoryName of [branding.dataDirectoryName, branding.toolsDirectoryName]) {
  const copied = copyTreeMissing(
    path.join(projectRoot, directoryName),
    path.join(targetDir, directoryName),
  );
  if (copied > 0) console.log(`[branding-home] seeded ${directoryName} (${copied} files)`);
}

const homeToolsPathToml = path
  .join(targetDir, branding.toolsDirectoryName)
  .replaceAll("\\", "\\\\");
const prepareConfigForHome = (sourcePath) => prepareHomeConfigText({ sourcePath, branding })
  .replaceAll(HOME_TOOLS_TOKEN, homeToolsPathToml)
  .replaceAll(".forgecode", branding.homeDirectoryName);

const projectConfig = path.join(projectRoot, branding.homeInitialization.configFileName);
const sourceConfig = fs.existsSync(projectConfig)
  ? projectConfig
  : path.join(sourceDir, branding.homeInitialization.configFileName);
const configTarget = path.join(targetDir, branding.homeInitialization.configFileName);
const configIsOlder = fs.existsSync(sourceConfig)
  && (!fs.existsSync(configTarget)
    || fs.statSync(configTarget).mtimeMs < fs.statSync(sourceConfig).mtimeMs);
if (configIsOlder) {
  const config = prepareConfigForHome(sourceConfig);
  fs.writeFileSync(configTarget, config, "utf-8");
  console.log(`[branding-home] synchronized ${branding.homeInitialization.configFileName}`);
} else if (fs.existsSync(configTarget) && fs.existsSync(projectConfig)) {
  const current = fs.readFileSync(configTarget, "utf-8");
  const seed = prepareConfigForHome(projectConfig);
  const merged = appendMissingMcpServerConfig(
    current,
    seed,
    branding.bundledMcpServer.section,
  );
  if (merged !== current) {
    fs.writeFileSync(configTarget, merged, "utf-8");
    console.log(`[branding-home] repaired ${branding.homeInitialization.configFileName} MCP configuration`);
  }
}

const authFileName = branding.homeInitialization.authFileName;
const authSource = path.join(sourceDir, authFileName);
const authSeedSource = path.join(projectRoot, authFileName);
const authTarget = path.join(targetDir, authFileName);
const seedAuthPath = fs.existsSync(authSeedSource) ? authSeedSource : authSource;
const shouldRefreshAuth = fs.existsSync(seedAuthPath)
  && (!fs.existsSync(authTarget)
    || fs.statSync(authTarget).mtimeMs < fs.statSync(seedAuthPath).mtimeMs);
if (shouldRefreshAuth) {
  fs.copyFileSync(seedAuthPath, authTarget);
  console.log(`[branding-home] synchronized ${authFileName}`);
}
