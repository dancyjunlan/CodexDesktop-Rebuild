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
if (!fs.existsSync(configTarget) && fs.existsSync(sourceConfig)) {
  const config = prepareConfigForHome(sourceConfig);
  fs.writeFileSync(configTarget, config, "utf-8");
  console.log(`[branding-home] seeded ${branding.homeInitialization.configFileName}`);
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
const authTarget = path.join(targetDir, authFileName);
if (!fs.existsSync(authTarget) && fs.existsSync(authSource)) {
  fs.copyFileSync(authSource, authTarget);
  console.log(`[branding-home] seeded ${authFileName}`);
}
