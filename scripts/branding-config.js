const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const brandingPath = path.join(PROJECT_ROOT, "branding.json");
const branding = JSON.parse(fs.readFileSync(brandingPath, "utf-8"));

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`branding.json: ${name} must be a non-empty string`);
  }
  return value;
}

function requireBranding() {
  for (const name of [
    "appName",
    "appBrand",
    "productMode",
    "assetRevision",
    "sidebarName",
    "homeGreeting",
    "packageName",
    "author",
    "description",
    "genericName",
    "devAppName",
    "homeDirectoryName",
    "dataDirectoryName",
    "databaseFileName",
    "devDatabaseFileName",
    "copyright",
  ]) {
    requireString(branding[name], name);
  }
  if (!["codex", "chatgpt"].includes(branding.appBrand)) {
    throw new Error("branding.json: appBrand must be either codex or chatgpt");
  }
  if (!["codex", "work"].includes(branding.productMode)) {
    throw new Error("branding.json: productMode must be either codex or work");
  }
  if (!branding.homeDirectoryName.startsWith(".")) {
    throw new Error("branding.json: homeDirectoryName must start with a dot");
  }
  if (path.isAbsolute(branding.dataDirectoryName) || branding.dataDirectoryName.includes("..")) {
    throw new Error("branding.json: dataDirectoryName must be a relative directory name");
  }
  requireString(branding.toolsDirectoryName, "toolsDirectoryName");
  if (path.isAbsolute(branding.toolsDirectoryName) || branding.toolsDirectoryName.includes("..")) {
    throw new Error("branding.json: toolsDirectoryName must be a relative directory name");
  }
  for (const name of [
    "resourceDirectoryName",
    "authFileName",
    "configFileName",
    "aclScriptFileName",
    "markerFileName",
    "failureMessage",
  ]) {
    requireString(branding.homeInitialization?.[name], `homeInitialization.${name}`);
  }
  if (
    path.isAbsolute(branding.homeInitialization.resourceDirectoryName) ||
    branding.homeInitialization.resourceDirectoryName.includes("..") ||
    /[\\/]/.test(branding.homeInitialization.resourceDirectoryName)
  ) {
    throw new Error("branding.json: homeInitialization.resourceDirectoryName must be a directory name");
  }
  for (const name of ["authFileName", "configFileName", "aclScriptFileName", "markerFileName"]) {
    const value = branding.homeInitialization[name];
    if (path.isAbsolute(value) || value.includes("..") || /[\\/]/.test(value)) {
      throw new Error(`branding.json: homeInitialization.${name} must be a file name`);
    }
  }
  for (const name of ["section", "commandPath", "cwdPath", "stateDirectoryName"]) {
    requireString(branding.bundledMcpServer?.[name], `bundledMcpServer.${name}`);
  }
  for (const name of ["commandPath", "cwdPath"]) {
    const value = branding.bundledMcpServer[name];
    if (path.isAbsolute(value) || value.includes("..")) {
      throw new Error(`branding.json: bundledMcpServer.${name} must be a relative path`);
    }
  }
  if (
    path.isAbsolute(branding.bundledMcpServer.stateDirectoryName) ||
    branding.bundledMcpServer.stateDirectoryName.includes("..") ||
    /[\\/]/.test(branding.bundledMcpServer.stateDirectoryName)
  ) {
    throw new Error("branding.json: bundledMcpServer.stateDirectoryName must be a directory name");
  }

  for (const name of [
    "appUserModelId",
    "trayGuid",
    "executableName",
    "hostExecutableName",
    "runtimeIconFileName",
    "runtimeUserDataDirectoryName",
    "installerFileName",
  ]) {
    requireString(branding.windows?.[name], `windows.${name}`);
  }

  for (const name of ["webview", "webviewSmall", "titlebar", "webviewAnimation", "windows", "macos", "linux", "packager"]) {
    requireString(branding.icons?.[name], `icons.${name}`);
  }
  for (const name of ["mint", "coral", "ink"]) {
    requireString(branding.theme?.[name], `theme.${name}`);
  }
  const ui = branding.ui;
  for (const name of [
    "hideWindowsSandboxBanner",
    "enablePermissionModeSelection",
    "hidePermissionModeHeader",
    "hideFullAccessRiskDescription",
    "hideFullAccessWarningLearnMore",
    "hideApiKeyAuthMenuItem",
    "hideLogoutMenuItem",
    "hideModelReasoningEffort",
    "hideSidebarPetMenuItem",
    "hideSidebarSettingsMenuItem",
    "hideSidebarHelpButton",
    "hideNativeHelpMenu",
    "hideNativeSettingsMenuItem",
    "hideNativeLogoutMenuItem",
    "skipOnboarding",
  ]) {
    if (typeof ui?.[name] !== "boolean") {
      throw new Error(`branding.json: ui.${name} must be a boolean`);
    }
  }
  for (const name of ["modelPickerLabel", "modelDisplayName"]) {
    requireString(ui?.[name], `ui.${name}`);
  }
  for (const name of [
    "hiddenWindowsSandboxLabels",
    "hiddenApiKeyAuthLabels",
    "hiddenLogoutLabels",
    "hiddenSidebarPetLabels",
    "hiddenSidebarSettingsLabels",
    "hiddenSidebarHelpButtonLabels",
    "hiddenModelReasoningEffortLabels",
    "modelPickerModelLabels",
  ]) {
    if (!Array.isArray(ui?.[name]) || ui[name].some((value) => typeof value !== "string" || value.trim().length === 0)) {
      throw new Error(`branding.json: ui.${name} must be an array of non-empty strings`);
    }
  }
  for (const name of ["stripInstallerComments", "repairInvalidUtf8OnStartup"]) {
    if (typeof branding.defaultConfig?.[name] !== "boolean") {
      throw new Error(`branding.json: defaultConfig.${name} must be a boolean`);
    }
  }
  return branding;
}

function iconPath(name) {
  return path.resolve(PROJECT_ROOT, requireString(branding.icons?.[name], `icons.${name}`));
}

function windowsExecutableBaseName() {
  return path.parse(branding.windows.executableName).name;
}

module.exports = {
  PROJECT_ROOT,
  branding: requireBranding(),
  iconPath,
  windowsExecutableBaseName,
};
