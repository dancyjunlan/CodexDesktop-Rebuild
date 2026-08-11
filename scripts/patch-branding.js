#!/usr/bin/env node
/**
 * Apply product branding after an upstream app bundle is extracted.
 *
 * Only user-visible identity is changed. Internal Codex protocol names, update
 * fields, authentication fields, and CLI paths stay intact for compatibility.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { SRC_DIR, PROJECT_ROOT, relPath } = require("./patch-util");

const config = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "branding.json"), "utf-8"),
);
const RESOURCE_DIR = path.join(PROJECT_ROOT, "resources");
const MARK_SOURCE = path.join(RESOURCE_DIR, "aigeek-mark.png");
const SHATTER_SOURCE = path.join(RESOURCE_DIR, "aigeek-logo-shatter.gif");
const WINDOWS_ICON_SOURCE = path.join(RESOURCE_DIR, "forgecode.ico");
const STYLE_SOURCE = path.join(RESOURCE_DIR, "forgecode-branding.css");
const SCRIPT_SOURCE = path.join(RESOURCE_DIR, "forgecode-branding.js");
const BLOCK_START = "<!-- FORGECODE_BRANDING_START -->";
const BLOCK_END = "<!-- FORGECODE_BRANDING_END -->";

function getPlatforms(platform) {
  if (platform) return [platform];
  return ["mac-arm64", "mac-x64", "win"].filter((candidate) =>
    fs.existsSync(path.join(SRC_DIR, candidate, "_asar")),
  );
}

function writeIfChanged(filePath, value) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
  if (current === value) return false;
  fs.writeFileSync(filePath, value, "utf-8");
  return true;
}

function patchPackage(platform) {
  const packagePath = path.join(SRC_DIR, platform, "_asar", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
  packageJson.name = config.packageName;
  packageJson.productName = config.appName;
  packageJson.author = config.author;
  packageJson.description = config.description;
  // The upstream MSIX advertises itself as the ChatGPT-branded OpenAI.Codex
  // package. Keeping those values makes Windows route activation to an
  // installed official Codex instance instead of this standalone application.
  packageJson.codexAppBrand = "codex";
  delete packageJson.codexWindowsPackageIdentity;
  delete packageJson.codexWindowsPackagePublisher;
  writeIfChanged(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
  return relPath(packagePath);
}

function patchWebview(platform) {
  const webviewDir = path.join(SRC_DIR, platform, "_asar", "webview");
  const indexPath = path.join(webviewDir, "index.html");
  const brandingBlock = [
    BLOCK_START,
    '    <link rel="stylesheet" href="./forgecode-branding.css" />',
    '    <script defer src="./forgecode-branding.js"></script>',
    `    ${BLOCK_END}`,
  ].join("\n");

  let index = fs.readFileSync(indexPath, "utf-8");
  index = index.replace(/<title>[^<]*<\/title>/, `<title>${config.appName}</title>`);
  const blockPattern = new RegExp(
    `${BLOCK_START}[\\s\\S]*?${BLOCK_END}`,
  );
  index = blockPattern.test(index)
    ? index.replace(blockPattern, brandingBlock)
    : index.replace("</head>", `${brandingBlock}\n  </head>`);
  writeIfChanged(indexPath, index);

  fs.copyFileSync(MARK_SOURCE, path.join(webviewDir, "aigeek-mark.png"));
  fs.copyFileSync(SHATTER_SOURCE, path.join(webviewDir, "aigeek-logo-shatter.gif"));
  fs.copyFileSync(STYLE_SOURCE, path.join(webviewDir, "forgecode-branding.css"));
  const script = fs
    .readFileSync(SCRIPT_SOURCE, "utf-8")
    .replace("__FORGECODE_NAME__", config.appName);
  writeIfChanged(path.join(webviewDir, "forgecode-branding.js"), script);

  return relPath(indexPath);
}

function replaceExact(source, search, replacement, label, filePath) {
  const count = source.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`${relPath(filePath)}: expected one ${label} match, found ${count}`);
  }
  return source.replace(search, replacement);
}

function patchMainProcess(platform) {
  const buildDir = path.join(SRC_DIR, platform, "_asar", ".vite", "build");
  const bootstrapName = fs.readdirSync(buildDir).find((file) => /^bootstrap-.*\.js$/.test(file));
  const mainName = fs.readdirSync(buildDir).find((file) => {
    if (!/^main-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(buildDir, file), "utf-8");
    return source.includes("windowIconPath:j,globalState");
  });
  const sqliteName = fs.readdirSync(buildDir).find((file) => {
    if (!/^src-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(buildDir, file), "utf-8");
    return source.includes("`codex-dev.db`") || source.includes("`" + config.devDatabaseFileName + "`");
  });
  if (!bootstrapName || !mainName || !sqliteName) {
    throw new Error(`${platform}: could not locate main-process branding bundles`);
  }

  const bootstrapPath = path.join(buildDir, bootstrapName);
  let bootstrap = fs.readFileSync(bootstrapPath, "utf-8");
  const appNameForBuildFlavor = "n===`dev`?`" + config.devAppName + "`:`" + config.appName + "`";
  const appNameForResolvedFlavor = "Z===`dev`?`" + config.devAppName + "`:`" + config.appName + "`";
  const upstreamAppUserModelId = "process.platform===`win32`&&a.app.setAppUserModelId(i.i(Z))";
  const brandedAppUserModelId = "process.platform===`win32`&&a.app.setAppUserModelId(Z===`dev`?`"
    + config.windowsAppUserModelId + ".dev`:`" + config.windowsAppUserModelId + "`)";
  const previousAppNameForBuildFlavor = "n===`dev`?`ForgeCode (Dev)`:`ForgeCode`";
  const previousAppNameForResolvedFlavor = "Z===`dev`?`ForgeCode (Dev)`:`ForgeCode`";
  if (bootstrap.includes("t.Ta(n)")) {
    bootstrap = replaceExact(bootstrap, "t.Ta(n)", appNameForBuildFlavor, "user-data app name", bootstrapPath);
  } else if (bootstrap.includes(previousAppNameForBuildFlavor)) {
    bootstrap = replaceExact(bootstrap, previousAppNameForBuildFlavor, appNameForBuildFlavor, "previous user-data app name", bootstrapPath);
  } else if (!bootstrap.includes(appNameForBuildFlavor)) {
    throw new Error(`${relPath(bootstrapPath)}: user-data app name was not recognized`);
  }
  if (bootstrap.includes("t.Ta(Z,Q)")) {
    bootstrap = replaceExact(bootstrap, "t.Ta(Z,Q)", appNameForResolvedFlavor, "application name", bootstrapPath);
  } else if (bootstrap.includes(previousAppNameForResolvedFlavor)) {
    bootstrap = replaceExact(bootstrap, previousAppNameForResolvedFlavor, appNameForResolvedFlavor, "previous application name", bootstrapPath);
  } else if (!bootstrap.includes(appNameForResolvedFlavor)) {
    throw new Error(`${relPath(bootstrapPath)}: application name was not recognized`);
  }
  if (bootstrap.includes(upstreamAppUserModelId)) {
    bootstrap = replaceExact(
      bootstrap,
      upstreamAppUserModelId,
      brandedAppUserModelId,
      "Windows AppUserModelID",
      bootstrapPath,
    );
  } else if (!bootstrap.includes(brandedAppUserModelId)) {
    throw new Error(`${relPath(bootstrapPath)}: Windows AppUserModelID was not recognized`);
  }
  writeIfChanged(bootstrapPath, bootstrap);

  const mainPath = path.join(buildDir, mainName);
  let main = fs.readFileSync(mainPath, "utf-8");
  const upstreamWindowIconPath = "j=process.platform===`linux`?G5(i,e,T):null";
  const brandedWindowIconPath = "j=process.platform===`linux`?G5(i,e,T):process.platform===`win32`?(0,p.join)(process.resourcesPath,`aigeek.ico`):null";
  if (main.includes(upstreamWindowIconPath)) {
    main = replaceExact(
      main,
      upstreamWindowIconPath,
      brandedWindowIconPath,
      "Windows window icon path",
      mainPath,
    );
  } else if (!main.includes(brandedWindowIconPath)) {
    throw new Error(`${relPath(mainPath)}: Windows window icon path was not recognized`);
  }
  writeIfChanged(mainPath, main);

  const sqlitePath = path.join(buildDir, sqliteName);
  let sqlite = fs.readFileSync(sqlitePath, "utf-8");
  const upstreamProdCount = sqlite.split("`codex.db`").length - 1;
  const upstreamDevCount = sqlite.split("`codex-dev.db`").length - 1;
  if (upstreamProdCount === 2 && upstreamDevCount === 2) {
    sqlite = sqlite.replaceAll("`codex.db`", "`" + config.databaseFileName + "`");
    sqlite = sqlite.replaceAll("`codex-dev.db`", "`" + config.devDatabaseFileName + "`");
  } else {
    const brandedProdCount = sqlite.split("`" + config.databaseFileName + "`").length - 1;
    const brandedDevCount = sqlite.split("`" + config.devDatabaseFileName + "`").length - 1;
    if (brandedProdCount !== 2 || brandedDevCount !== 2) {
      throw new Error(`${relPath(sqlitePath)}: unexpected SQLite filename match count`);
    }
  }
  const upstreamHome = "i.join(r.homedir(),`.codex`)";
  const brandedHome = "i.join(r.homedir(),`.forgecode`)";
  const upstreamHomeCount = sqlite.split(upstreamHome).length - 1;
  if (upstreamHomeCount === 2) {
    sqlite = sqlite.replaceAll(upstreamHome, brandedHome);
  } else if ((sqlite.split(brandedHome).length - 1) !== 2) {
    throw new Error(`${relPath(sqlitePath)}: unexpected CODEX_HOME fallback match count`);
  }
  writeIfChanged(sqlitePath, sqlite);

  return [relPath(bootstrapPath), relPath(mainPath), relPath(sqlitePath)];
}

function patchWindowsRuntimeIcon(platform) {
  if (platform !== "win") return null;

  const upstreamRuntimeExe = path.join(SRC_DIR, "win", "runtime", "ChatGPT.exe");
  const brandedRuntimeExe = path.join(SRC_DIR, "win", "runtime", "AIGeek.exe");
  const runtimeResourcesDir = path.join(SRC_DIR, "win", "runtime", "resources");
  const packagedResourcesIcon = path.join(SRC_DIR, "win", "aigeek.ico");
  const runtimeResourcesIcon = path.join(runtimeResourcesDir, "aigeek.ico");
  const rceditExe = path.join(
    PROJECT_ROOT,
    "node_modules",
    "electron-winstaller",
    "vendor",
    "rcedit.exe",
  );
  if (!fs.existsSync(upstreamRuntimeExe) || !fs.existsSync(rceditExe)) {
    throw new Error("win: runtime icon tooling was not found");
  }

  // BrowserWindow loads this path for both the unpackaged runtime and a Forge
  // package. The latter receives src/win/aigeek.ico through packageAfterCopy.
  fs.mkdirSync(runtimeResourcesDir, { recursive: true });
  fs.copyFileSync(WINDOWS_ICON_SOURCE, runtimeResourcesIcon);
  fs.copyFileSync(WINDOWS_ICON_SOURCE, packagedResourcesIcon);

  // Windows keeps taskbar icon associations per executable path. Running the
  // branded copy avoids retaining the upstream ChatGPT.exe icon from Shell's
  // cache while preserving the extracted runtime as an untouched base.
  if (!fs.existsSync(brandedRuntimeExe)) {
    fs.copyFileSync(upstreamRuntimeExe, brandedRuntimeExe);
  }

  try {
    execFileSync(rceditExe, [brandedRuntimeExe, "--set-icon", WINDOWS_ICON_SOURCE], {
      stdio: "pipe",
    });
  } catch (error) {
    const details = error.stderr?.toString("utf-8") ?? "";
    if (details.includes("Unable to commit changes")) {
      console.warn("  [win] runtime icon pending: close AIGeek and run the dev command again");
      return null;
    }
    throw error;
  }
  return relPath(brandedRuntimeExe);
}

function patchOnboarding(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const onboardingName = fs.readdirSync(assetsDir).find((file) =>
    /^onboarding-page-.*\.js$/.test(file),
  );
  if (!onboardingName) {
    throw new Error(`${platform}: could not locate the onboarding bundle`);
  }

  const onboardingPath = path.join(assetsDir, onboardingName);
  let onboarding = fs.readFileSync(onboardingPath, "utf-8");
  const upstream = "):On=t[179];let kn;return t[180]!==pt";
  const branded = "):On=t[179];globalThis.__forgecodeOnboardingSkipped??(globalThis.__forgecodeOnboardingSkipped=!0,queueMicrotask(On));let kn;return t[180]!==pt";

  if (onboarding.includes(upstream)) {
    onboarding = replaceExact(
      onboarding,
      upstream,
      branded,
      "onboarding skip hook",
      onboardingPath,
    );
  } else if (!onboarding.includes("__forgecodeOnboardingSkipped")) {
    throw new Error(`${relPath(onboardingPath)}: onboarding skip hook was not recognized`);
  }
  writeIfChanged(onboardingPath, onboarding);
  return relPath(onboardingPath);
}

function patchWebviewStartupLogo(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const appInitialName = fs.readdirSync(assetsDir).find((file) => {
    if (!/^app-initial-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(assetsDir, file), "utf-8");
    return source.includes("a=r===void 0?dg:r")
      || source.includes("data-forgecode-startup-icon");
  });
  if (!appInitialName) {
    throw new Error(`${platform}: could not locate the webview startup logo bundle`);
  }

  const appInitialPath = path.join(assetsDir, appInitialName);
  let source = fs.readFileSync(appInitialPath, "utf-8");
  const upstreamIcon = "a=r===void 0?dg:r";
  const brandedIcon = "a=r===void 0?e=>(0,pir.jsx)(`img`,{src:`./aigeek-mark.png`,alt:``,\"data-forgecode-startup-icon\":!0,...e}):r";
  const upstreamMask = "o=i===void 0?mir:i";
  const brandedMask = "o=i===void 0?`./aigeek-mark.png`:i";

  if (source.includes(upstreamIcon)) {
    source = replaceExact(source, upstreamIcon, brandedIcon, "webview startup icon", appInitialPath);
    source = replaceExact(source, upstreamMask, brandedMask, "webview startup mask", appInitialPath);
  } else if (source.includes("data-forgecode-startup-icon")) {
    source = source.replaceAll("./forgecode-mark.svg", "./aigeek-mark.png");
  } else {
    throw new Error(`${relPath(appInitialPath)}: webview startup logo was not recognized`);
  }
  writeIfChanged(appInitialPath, source);
  return relPath(appInitialPath);
}

function patchLocaleBrandCopy(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const localeName = fs.readdirSync(assetsDir).find((file) => {
    if (!/^zh-CN-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(assetsDir, file), "utf-8");
    return source.includes("composer.placeholder.workWithChatGPT");
  });
  if (!localeName) {
    throw new Error(`${platform}: could not locate the Chinese composer locale bundle`);
  }

  const localePath = path.join(assetsDir, localeName);
  let source = fs.readFileSync(localePath, "utf-8");
  const upstream = "\"composer.placeholder.workWithChatGPT\":`使用 ChatGPT Work`";
  const branded = "\"composer.placeholder.workWithChatGPT\":`使用 ForgeCode`";

  if (source.includes(upstream)) {
    source = replaceExact(source, upstream, branded, "Chinese composer placeholder", localePath);
  } else if (!source.includes(branded)) {
    throw new Error(`${relPath(localePath)}: Chinese composer placeholder was not recognized`);
  }
  writeIfChanged(localePath, source);
  return relPath(localePath);
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const platforms = getPlatforms(platform);

  if (platforms.length === 0) {
    console.error("[x] No extracted upstream bundle found. Run npm run sync first.");
    process.exit(1);
  }

  for (const target of platforms) {
    const asarDir = path.join(SRC_DIR, target, "_asar");
    const packagePath = path.join(asarDir, "package.json");
    const indexPath = path.join(asarDir, "webview", "index.html");

    if (!fs.existsSync(packagePath) || !fs.existsSync(indexPath)) {
      console.error(`[x] ${target}: incomplete extracted bundle`);
      process.exitCode = 1;
      continue;
    }

    if (isCheck) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      const index = fs.readFileSync(indexPath, "utf-8");
      const buildDir = path.join(asarDir, ".vite", "build");
      const bootstrapName = fs.readdirSync(buildDir).find((file) => /^bootstrap-.*\.js$/.test(file));
      const sqliteName = fs.readdirSync(buildDir).find((file) => {
        if (!/^src-.*\.js$/.test(file)) return false;
        const source = fs.readFileSync(path.join(buildDir, file), "utf-8");
        return source.includes("`" + config.devDatabaseFileName + "`");
      });
      const onboardingName = fs.readdirSync(path.join(asarDir, "webview", "assets")).find((file) =>
        /^onboarding-page-.*\.js$/.test(file),
      );
      const appInitialName = fs.readdirSync(path.join(asarDir, "webview", "assets")).find((file) =>
        /^app-initial-.*\.js$/.test(file),
      );
      const localeName = fs.readdirSync(path.join(asarDir, "webview", "assets")).find((file) =>
        /^zh-CN-.*\.js$/.test(file),
      );
      const bootstrap = bootstrapName ? fs.readFileSync(path.join(buildDir, bootstrapName), "utf-8") : "";
      const sqlite = sqliteName ? fs.readFileSync(path.join(buildDir, sqliteName), "utf-8") : "";
      const onboarding = onboardingName
        ? fs.readFileSync(path.join(asarDir, "webview", "assets", onboardingName), "utf-8")
        : "";
      const appInitial = appInitialName
        ? fs.readFileSync(path.join(asarDir, "webview", "assets", appInitialName), "utf-8")
        : "";
      const locale = localeName
        ? fs.readFileSync(path.join(asarDir, "webview", "assets", localeName), "utf-8")
        : "";
      const ready = packageJson.productName === config.appName
        && index.includes(BLOCK_START)
        && bootstrap.includes(config.devAppName)
        && sqlite.includes(config.devDatabaseFileName)
        && sqlite.includes(".forgecode")
        && onboarding.includes("__forgecodeOnboardingSkipped")
        && appInitial.includes("data-forgecode-startup-icon")
        && locale.includes("\"composer.placeholder.workWithChatGPT\":`使用 ForgeCode`");
      console.log(`  [${target}] ${ready ? "ready" : "needs patch"}`);
      if (!ready) process.exitCode = 1;
      continue;
    }

    console.log(`  [${target}] ${patchPackage(target)}`);
    console.log(`  [${target}] ${patchWebview(target)}`);
    for (const filePath of patchMainProcess(target)) {
      console.log(`  [${target}] ${filePath}`);
    }
    const runtimeIconPath = patchWindowsRuntimeIcon(target);
    if (runtimeIconPath) console.log(`  [${target}] ${runtimeIconPath}`);
    console.log(`  [${target}] ${patchOnboarding(target)}`);
    console.log(`  [${target}] ${patchWebviewStartupLogo(target)}`);
    console.log(`  [${target}] ${patchLocaleBrandCopy(target)}`);
  }
}

main();
