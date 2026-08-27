#!/usr/bin/env node
/**
 * build-from-upstream.js — Patch upstream Codex and repackage
 *
 * For macOS and Windows: no forge needed.
 * Takes the upstream app, patches ASAR in-place, replaces codex CLI, outputs distributable.
 *
 * Usage:
 *   node scripts/build-from-upstream.js --platform mac-arm64
 *   node scripts/build-from-upstream.js --platform mac-x64
 *   node scripts/build-from-upstream.js --platform win
 */
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const os = require("os");
const asar = require("@electron/asar");
const { brandWindowsExecutable } = require("./windows-executable-branding");
const {
  PROJECT_ROOT,
  branding,
  iconPath,
  windowsExecutableBaseName,
} = require("./branding-config");
const { syncBrandingMetadata } = require("./sync-branding-metadata");
const { prepareHomeConfig } = require("./prepare-home-config");

const SRC_DIR = path.join(PROJECT_ROOT, "src");
const OUT_DIR = path.join(PROJECT_ROOT, "out");
const WINDOWS_LAUNCHER_SOURCE = path.join(PROJECT_ROOT, "resources", "aigeek-launcher.cs");
const WINDOWS_CSC = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const windowsBranding = branding.windows;
const NOTIFICATION_HELPER_EXECUTABLE_NAME = "notification_helper.exe";

const TARGET_TRIPLE_MAP = {
  "mac-arm64": "aarch64-apple-darwin",
  "mac-x64": "x86_64-apple-darwin",
  "win": "x86_64-pc-windows-msvc",
};

// ─── Helpers ────────────────────────────────────────────────────

function clearDir(dir) {
  // Windows can briefly retain a directory handle after an archiver or virus
  // scanner exits. Retry EPERM/EBUSY rather than failing a valid rebuild.
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function getCopyConcurrency() {
  const configured = Number.parseInt(process.env.AIGEEK_COPY_CONCURRENCY || "", 10);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, 64);
  }

  const cores = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.min(Math.max(cores, 4), 16);
}

async function copyRecursiveConcurrent(src, dest, options = {}) {
  const { concurrency = getCopyConcurrency(), skip } = options;
  const entries = [];

  const collectEntries = (source, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      const relativePath = path.relative(src, sourcePath);
      if (skip?.(relativePath, entry)) continue;

      if (entry.isDirectory()) {
        collectEntries(sourcePath, destinationPath);
      } else {
        entries.push({ sourcePath, destinationPath, entry });
      }
    }
  };

  collectEntries(src, dest);
  let next = 0;
  let copied = 0;
  const workerCount = Math.min(concurrency, entries.length);

  const worker = async () => {
    while (next < entries.length) {
      const current = entries[next++];
      if (current.entry.isSymbolicLink()) {
        const target = await fs.promises.readlink(current.sourcePath);
        try { await fs.promises.symlink(target, current.destinationPath); } catch {}
      } else {
        await fs.promises.copyFile(current.sourcePath, current.destinationPath);
      }
      copied++;
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return copied;
}

async function packAsar(source, destination) {
  // Calling npx.cmd through spawn fails with EINVAL under the Node version
  // bundled on this Windows machine. The project already depends on asar, so
  // invoke its API directly and avoid a shell wrapper altogether.
  await asar.createPackage(source, destination);
}

function resolveCodexVendor(platform) {
  const triple = TARGET_TRIPLE_MAP[platform];
  if (!triple) return null;
  const binName = platform === "win" ? "codex.exe" : "codex";

  // sync-upstream already extracts the matching CLI with the desktop runtime.
  // Prefer it to a network lookup so an offline build remains reproducible.
  const extractedCli = path.join(SRC_DIR, platform, binName);
  if (fs.existsSync(extractedCli)) return extractedCli;

  // Try platform-specific package (0.128+)
  const PKG_MAP = { "mac-arm64": "codex-darwin-arm64", "mac-x64": "codex-darwin-x64", "win": "codex-win32-x64" };
  const platPkg = PKG_MAP[platform];
  if (platPkg) {
    const p = path.join(PROJECT_ROOT, "node_modules", "@cometix", platPkg, "vendor", triple, "codex", binName);
    if (fs.existsSync(p)) return p;
  }
  // Try old-style vendor (pre-0.128)
  const localPath = path.join(PROJECT_ROOT, "node_modules", "@cometix", "codex", "vendor", triple, "codex", binName);
  if (fs.existsSync(localPath)) return localPath;

  // npm pack fallback — fetch platform-specific package
  // First get latest cometix base version, then append platform suffix
  const PLAT_SUFFIX = {
    "mac-arm64": "darwin-arm64", "mac-x64": "darwin-x64",
    "win": "win32-x64",
    "linux-x64": "linux-x64", "linux-arm64": "linux-arm64",
  };
  const suffix = PLAT_SUFFIX[platform];
  if (!suffix) return null;

  let baseVer;
  try {
    baseVer = execSync("npm view @cometix/codex version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return null; }
  if (!baseVer) return null;

  // e.g. "0.128.0-cometix" → "@cometix/codex@0.128.0-cometix-darwin-x64"
  const platPkgSpec = `@cometix/codex@${baseVer}-${suffix}`;
  console.log(`   [codex] fetching ${platPkgSpec} via npm pack...`);
  const tmpDir = path.join(require("os").tmpdir(), "cometix-codex-pack");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const tgzName = execSync(`npm pack ${platPkgSpec} --pack-destination "${tmpDir}"`, {
      cwd: tmpDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    }).trim().split("\n").pop();
    const extractDir = path.join(tmpDir, "extracted");
    clearDir(extractDir);
    execSync(`tar xzf "${path.join(tmpDir, tgzName)}" -C "${extractDir}"`, { stdio: "pipe" });
    const p = path.join(extractDir, "package", "vendor", triple, "codex", binName);
    if (fs.existsSync(p)) return p;
  } catch (e) {
    console.log(`   [!] npm pack failed: ${e.message}`);
  }
  return null;
}

async function setWindowsExecutableIdentity(exePath, iconPath, originalFilename) {
  await brandWindowsExecutable(exePath, iconPath, {
    ProductName: branding.appName,
    FileDescription: `${branding.appName} Desktop`,
    CompanyName: branding.author,
    OriginalFilename: originalFilename,
  });
}

function escapeCSharpString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function renderWindowsLauncherSource() {
  const source = fs.readFileSync(WINDOWS_LAUNCHER_SOURCE, "utf-8");
  const values = {
    "__BRANDING_WINDOWS_APP_USER_MODEL_ID__": windowsBranding.appUserModelId,
    "__BRANDING_WINDOWS_HOST_EXECUTABLE_NAME__": windowsBranding.hostExecutableName,
    "__BRANDING_WINDOWS_APP_DATA_DIRECTORY_NAME__": windowsBranding.runtimeUserDataDirectoryName,
    "__BRANDING_APP_NAME__": branding.appName,
  };

  let rendered = source;
  for (const [placeholder, value] of Object.entries(values)) {
    if (!rendered.includes(placeholder)) {
      throw new Error(`Windows launcher template is missing ${placeholder}`);
    }
    rendered = rendered.replaceAll(placeholder, escapeCSharpString(value));
  }
  return rendered;
}

function renderLicense() {
  const template = fs.readFileSync(path.join(PROJECT_ROOT, "resources", "LICENSE"), "utf-8");
  return template
    .replaceAll("__BRANDING_APP_NAME__", branding.appName)
    .replaceAll("__BRANDING_COPYRIGHT__", branding.copyright);
}

async function buildWindowsLauncher(destination, iconPath) {
  if (!fs.existsSync(WINDOWS_CSC)) {
    throw new Error("Windows C# compiler was not found; cannot build the branded launcher");
  }
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "branding-launcher-"));
  const temporarySource = path.join(temporaryDirectory, "launcher.cs");
  try {
    fs.writeFileSync(temporarySource, renderWindowsLauncherSource(), "utf-8");
    execFileSync(WINDOWS_CSC, [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      "/out:" + destination,
      temporarySource,
    ], { stdio: "pipe" });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  await setWindowsExecutableIdentity(destination, iconPath, windowsBranding.executableName);
}

function patchWindowsRuntimeIdentity(resourcesDir) {
  const iniPath = path.join(resourcesDir, "owl-app.ini");
  if (!fs.existsSync(iniPath)) {
    throw new Error("Windows Owl runtime configuration was not found");
  }

  const upstream = "UserDataDirectoryName=Codex";
  const branded = `UserDataDirectoryName=${windowsBranding.runtimeUserDataDirectoryName}`;
  const source = fs.readFileSync(iniPath, "utf-8");
  if (source.includes(upstream)) {
    fs.writeFileSync(iniPath, source.replace(upstream, branded), "utf-8");
  } else if (!source.includes(branded)) {
    throw new Error("Windows Owl runtime identity was not recognized");
  }
}

function stageWindowsHomeInitializationAssets(outApp) {
  const sourcePaths = {
    data: path.join(PROJECT_ROOT, branding.dataDirectoryName),
    tools: path.join(PROJECT_ROOT, branding.toolsDirectoryName),
    auth: path.join(PROJECT_ROOT, "auth.json"),
    config: path.join(PROJECT_ROOT, "config.toml"),
    aclScript: path.join(PROJECT_ROOT, "resources", "secure-private-package.ps1"),
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

  const initialization = branding.homeInitialization;
  const seedRoot = path.join(outApp, "resources", initialization.resourceDirectoryName);
  fs.mkdirSync(seedRoot, { recursive: true });
  fs.cpSync(sourcePaths.data, path.join(seedRoot, branding.dataDirectoryName), {
    recursive: true,
    force: true,
  });
  fs.cpSync(sourcePaths.tools, path.join(seedRoot, branding.toolsDirectoryName), {
    recursive: true,
    force: true,
  });
  fs.copyFileSync(sourcePaths.auth, path.join(seedRoot, initialization.authFileName));
  prepareHomeConfig({
    sourcePath: sourcePaths.config,
    destinationPath: path.join(seedRoot, initialization.configFileName),
    branding,
  });
  fs.copyFileSync(sourcePaths.aclScript, path.join(seedRoot, initialization.aclScriptFileName));
  console.log(`   [home] staged per-user initialization assets in resources/${initialization.resourceDirectoryName}`);
}

// ─── macOS build ────────────────────────────────────────────────

function buildMac(platform) {
  const platformDir = path.join(SRC_DIR, platform);
  const asarDir = path.join(platformDir, "_asar");

  if (!fs.existsSync(asarDir)) {
    console.error(`[x] ${platform}/_asar/ not found. Run sync-upstream first.`);
    process.exit(1);
  }

  // 1. Find the .app in the ZIP extract cache
  const tempDir = path.join(require("os").tmpdir(), "codex-sync");
  const variant = platform === "mac-arm64" ? "arm64" : "x64";
  const extractDir = path.join(tempDir, `${variant}-extract`);

  // Find Codex.app
  let appPath = null;
  if (fs.existsSync(extractDir)) {
    const findApp = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "Codex.app" && e.isDirectory()) return path.join(dir, e.name);
        if (e.isDirectory()) { const r = findApp(path.join(dir, e.name)); if (r) return r; }
      }
      return null;
    };
    appPath = findApp(extractDir);
  }

  if (!appPath) {
    console.error(`[x] Codex.app not found in cache. Run sync-upstream first.`);
    process.exit(1);
  }

  console.log(`   [source] ${appPath}`);

  // 2. Copy .app to output (ditto preserves symlinks + resource forks)
  const outAppDir = path.join(OUT_DIR, platform);
  clearDir(outAppDir);
  const outApp = path.join(outAppDir, `${branding.appName}.app`);
  console.log("   [copy] Codex.app -> out/");
  execSync(`ditto "${appPath}" "${outApp}"`);

  const resourcesDir = path.join(outApp, "Contents", "Resources");

  // 3. Repack patched ASAR
  const asarPath = path.join(resourcesDir, "app.asar");
  console.log("   [asar pack] _asar/ -> app.asar");
  execSync(`npx asar pack "${asarDir}" "${asarPath}"`);

  // 4. Update ASAR integrity hash in Info.plist
  const infoPlist = path.join(outApp, "Contents", "Info.plist");
  if (fs.existsSync(infoPlist)) {
    updateAsarIntegrity(asarPath, infoPlist);
  }

  // 5. Strip original signature + quarantine
  console.log("   [codesign] removing original signature");
  try { execSync(`codesign --remove-signature "${outApp}"`, { stdio: "pipe" }); } catch {}
  try { execSync(`xattr -rd com.apple.quarantine "${outApp}"`, { stdio: "pipe" }); } catch {}

  // 6. Replace codex CLI
  replaceCodex(platform, resourcesDir, "codex");

  // 7. Ad-hoc re-sign (prevents "damaged app" Gatekeeper error)
  console.log("   [codesign] ad-hoc signing");
  try {
    execSync(`codesign --sign - --force --deep "${outApp}"`, { stdio: "pipe" });
    console.log("   [ok] ad-hoc signed");
  } catch (e) {
    console.log(`   [!] ad-hoc sign failed: ${e.message}`);
  }

  // 8. Create DMG
  const version = getVersion(asarDir);
  const dmgName = `${branding.appName}-${platform}-${version}.dmg`;
  const dmgPath = path.join(OUT_DIR, dmgName);
  console.log(`   [dmg] ${dmgName}`);
  execSync(`hdiutil create -volname "${branding.appName}" -srcfolder "${outAppDir}" -ov -format UDZO "${dmgPath}"`, { stdio: "pipe" });
  const sizeMB = (fs.statSync(dmgPath).size / 1048576).toFixed(1);
  console.log(`   [ok] ${dmgPath} (${sizeMB} MB)`);
}

// ─── Windows build ──────────────────────────────────────────────

async function buildWin(platform) {
  const platformDir = path.join(SRC_DIR, platform);
  const asarDir = path.join(platformDir, "_asar");

  if (!fs.existsSync(asarDir)) {
    console.error(`[x] win/_asar/ not found. Run sync-upstream first.`);
    process.exit(1);
  }

  // Windows: use the MSIX extract cache
  const tempDir = path.join(require("os").tmpdir(), "codex-sync");
  const extractDir = path.join(tempDir, "win-extract");
  const appDir = path.join(extractDir, "app");
  const checkedInRuntimeDir = path.join(platformDir, "runtime");
  const hasCompleteCachedRuntime = fs.existsSync(path.join(appDir, "ChatGPT.exe"))
    && fs.existsSync(path.join(appDir, "resources", "owl-app.ini"));
  const hasCheckedInRuntime = fs.existsSync(path.join(checkedInRuntimeDir, "ChatGPT.exe"));

  if (!hasCompleteCachedRuntime && !hasCheckedInRuntime) {
    console.error(`[x] Windows runtime is unavailable. Run sync-upstream first.`);
    process.exit(1);
  }

  // Copy the runtime while packing the patched ASAR. These paths are
  // independent; omitting the upstream archive avoids duplicate I/O and a
  // concurrent write to the same destination.
  const outAppDir = path.join(OUT_DIR, "win");
  clearDir(outAppDir);
  const outApp = path.join(outAppDir, `${windowsExecutableBaseName()}-win-x64`);
  const resourcesDir = path.join(outApp, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  const copyConcurrency = getCopyConcurrency();
  if (!process.env.UV_THREADPOOL_SIZE) {
    process.env.UV_THREADPOOL_SIZE = String(copyConcurrency);
  }
  fs.mkdirSync(resourcesDir, { recursive: true });
  let copyPromise;
  if (hasCompleteCachedRuntime) {
    console.log(`   [copy] MSIX app/ -> out/ (${copyConcurrency} workers)`);
    copyPromise = copyRecursiveConcurrent(appDir, outApp, {
      concurrency: copyConcurrency,
      skip: (relativePath, entry) =>
        !entry.isDirectory() && relativePath === path.join("resources", "app.asar"),
    });
  } else {
    // %TEMP% can be cleaned by Windows between sync and build. The sync step
    // also snapshots the runtime and resources under src/win, so rebuild from
    // that durable source instead of failing on a missing cache.
    console.log(`   [copy] src/win runtime snapshot -> out/ (${copyConcurrency} workers)`);
    copyPromise = Promise.all([
      copyRecursiveConcurrent(checkedInRuntimeDir, outApp, { concurrency: copyConcurrency }),
      copyRecursiveConcurrent(platformDir, resourcesDir, {
        concurrency: copyConcurrency,
        skip: (relativePath) => relativePath === "_asar" || relativePath === "runtime",
      }),
    ]).then(([runtimeFiles, resourceFiles]) => runtimeFiles + resourceFiles);
  }
  console.log("   [asar pack] _asar/ -> app.asar (parallel with copy)");
  const [copied] = await Promise.all([
    copyPromise,
    packAsar(asarDir, asarPath),
  ]);
  console.log(`   [copy] completed ${copied} files`);

  stageWindowsHomeInitializationAssets(outApp);

  const windowsIconPath = iconPath("windows");
  const upstreamRuntimeExe = path.join(outApp, "ChatGPT.exe");
  const brandedRuntimeExe = path.join(outApp, windowsBranding.hostExecutableName);
  const notificationHelperExe = path.join(outApp, NOTIFICATION_HELPER_EXECUTABLE_NAME);
  patchWindowsRuntimeIdentity(resourcesDir);
  fs.copyFileSync(windowsIconPath, path.join(resourcesDir, windowsBranding.runtimeIconFileName));
  for (const trayIcon of [
    "chatgpt-tray-light.ico",
    "chatgpt-tray-dark.ico",
    "icon-chatgpt.ico",
  ]) {
    fs.copyFileSync(windowsIconPath, path.join(resourcesDir, trayIcon));
  }

  // This MSIX runtime does not embed an app.asar header hash in its EXEs.
  // The previous byte-replacement attempt therefore never matched and could
  // not affect loading. The repacked archive is loaded directly from resources.

  // The outer launcher owns the public executable and always supplies an
  // independent Chromium data directory. The Owl host cannot do that itself:
  // it only accepts a directory name below Roaming\\Codex\\web.
  fs.copyFileSync(upstreamRuntimeExe, brandedRuntimeExe);
  await setWindowsExecutableIdentity(brandedRuntimeExe, windowsIconPath, windowsBranding.hostExecutableName);
  if (fs.existsSync(notificationHelperExe)) {
    await setWindowsExecutableIdentity(
      notificationHelperExe,
      windowsIconPath,
      NOTIFICATION_HELPER_EXECUTABLE_NAME,
    );
  }
  await buildWindowsLauncher(path.join(outApp, windowsBranding.executableName), windowsIconPath);
  fs.rmSync(upstreamRuntimeExe, { force: true });

  // The extracted upstream runtime is too large for a responsive self-
  // extracting installer. Distribute one normal application directory instead
  // so the user can run the branded executable directly with no install-time
  // compression or secondary launcher involved.
  fs.writeFileSync(
    path.join(outApp, `Start-${windowsExecutableBaseName()}.cmd`),
    `@echo off\r\nstart "" "%~dp0${windowsBranding.executableName}"\r\n`,
    "ascii",
  );
  fs.writeFileSync(path.join(outApp, "LICENSE"), renderLicense(), "utf-8");

  // Replace codex CLI
  replaceCodex(platform, resourcesDir, "codex.exe");

  // The MSIX root Codex.exe is only a launcher that activates an existing
  // installed Codex session. It is not this portable app's Electron host and
  // makes users accidentally reopen the official app instead of the branded app.
  fs.rmSync(path.join(outApp, "Codex.exe"), { force: true });

  const oldInstallerPath = path.join(OUT_DIR, windowsBranding.installerFileName);
  fs.rmSync(oldInstallerPath, { force: true });
  if (fs.existsSync(path.join(outApp, "Codex.exe"))) {
    throw new Error("Windows output retained the upstream Codex launcher");
  }
  const runtimeIni = fs.readFileSync(path.join(resourcesDir, "owl-app.ini"), "utf-8");
  if (!runtimeIni.includes(`UserDataDirectoryName=${windowsBranding.runtimeUserDataDirectoryName}`)) {
    throw new Error("Windows output did not retain the configured Owl runtime identity");
  }
  console.log(`   [ok] portable app: ${outApp}`);
}

// ─── ASAR integrity ─────────────────────────────────────────────

function computeAsarHeaderHash(asarPath) {
  const crypto = require("crypto");
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  const header = buf.slice(16, 16 + headerSize);
  return crypto.createHash("sha256").update(header).digest("hex");
}

function updateAsarIntegrity(asarPath, infoPlistPath) {
  const newHash = computeAsarHeaderHash(asarPath);
  execSync(`plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.hash -string "${newHash}" "${infoPlistPath}"`, { stdio: "pipe" });
  execSync(`plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.algorithm -string "SHA256" "${infoPlistPath}"`, { stdio: "pipe" });

  // Verify
  const verify = execSync(`plutil -extract ElectronAsarIntegrity.Resources/app\\\\.asar.hash raw "${infoPlistPath}"`, { encoding: "utf-8" }).trim();
  if (verify === newHash) {
    console.log(`   [integrity] hash updated: ${newHash.slice(0, 16)}...`);
  } else {
    console.log(`   [!] integrity verify failed`);
  }
}

// ─── Shared ─────────────────────────────────────────────────────

function replaceCodex(platform, resourcesDir, binName) {
  const vendor = resolveCodexVendor(platform);
  if (vendor) {
    const dest = path.join(resourcesDir, binName);
    fs.copyFileSync(vendor, dest);
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`   [codex] replaced with @cometix/codex`);
  } else {
    console.log(`   [!] @cometix/codex not found, keeping upstream codex`);
  }
}

function getVersion(asarDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(asarDir, "package.json"), "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function applyPatches(platform) {
  console.log("   [patch] applying local patches");
  execFileSync(process.execPath, [path.join(__dirname, "patch-all.js"), platform], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const platIdx = args.indexOf("--platform");
  const platform = platIdx !== -1 ? args[platIdx + 1] : null;

  if (!platform || !["mac-arm64", "mac-x64", "win"].includes(platform)) {
    console.error("[x] Usage: build-from-upstream.js --platform <mac-arm64|mac-x64|win>");
    process.exit(1);
  }

  syncBrandingMetadata();
  console.log(`\n== Build from upstream: ${platform} ==\n`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  applyPatches(platform);

  if (platform.startsWith("mac")) {
    buildMac(platform);
  } else {
    await buildWin(platform);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
