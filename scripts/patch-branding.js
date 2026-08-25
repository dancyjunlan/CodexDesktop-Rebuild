#!/usr/bin/env node
/**
 * Apply product branding after an upstream app bundle is extracted.
 *
 * Only user-visible identity is changed. Internal Codex protocol names, update
 * fields, authentication fields, and CLI paths stay intact for compatibility.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, PROJECT_ROOT, relPath } = require("./patch-util");
const {
  brandWindowsExecutable,
  windowsExecutableHasPrimaryIcon,
} = require("./windows-executable-branding");
const { branding: config, iconPath } = require("./branding-config");
const RESOURCE_DIR = path.join(PROJECT_ROOT, "resources");
const windowsBranding = config.windows;
const MARK_SOURCE = iconPath("webview");
const SMALL_MARK_SOURCE = iconPath("webviewSmall");
const TITLEBAR_MARK_SOURCE = iconPath("titlebar");
const SHATTER_SOURCE = iconPath("webviewAnimation");
const WINDOWS_ICON_SOURCE = iconPath("windows");
const WEBVIEW_ICON_FILE_NAME = path.basename(config.icons.webview);
const WEBVIEW_SMALL_ICON_FILE_NAME = path.basename(config.icons.webviewSmall);
const TITLEBAR_ICON_FILE_NAME = `branding-titlebar${path.extname(config.icons.titlebar)}`;
const WEBVIEW_ANIMATION_FILE_NAME = path.basename(config.icons.webviewAnimation);
const BRAND_ASSET_REVISION = encodeURIComponent(config.assetRevision);
const STYLE_SOURCE = path.join(RESOURCE_DIR, "forgecode-branding.css");
const SCRIPT_SOURCE = path.join(RESOURCE_DIR, "forgecode-branding.js");
const WINDOWS_RUNTIME_INI = path.join(SRC_DIR, "win", "owl-app.ini");
const NOTIFICATION_HELPER_EXECUTABLE_NAME = "notification_helper.exe";
// Owl builds the Chromium path below Roaming\\Codex\\web. Resolve back to
// Roaming before appending the branded directory so it never shares Codex's
// app-data root.
const WINDOWS_RUNTIME_USER_DATA_NAME = windowsBranding.runtimeUserDataDirectoryName;
const PREVIOUS_DATABASE_FILE_NAME = "forgecode.db";
const PREVIOUS_DEV_DATABASE_FILE_NAME = "forgecode-dev.db";
const BLOCK_START = "<!-- FORGECODE_BRANDING_START -->";
const BLOCK_END = "<!-- FORGECODE_BRANDING_END -->";
const UPSTREAM_NATIVE_HELP_MENU_BUILD = "Ut=l.Menu.buildFromTemplate(Ht)";
const BRANDED_NATIVE_HELP_MENU_BUILD = "Ut=(Ht=Ht.filter(e=>e.id!==et.help),l.Menu.buildFromTemplate(Ht))";
const LEGACY_NATIVE_HELP_MENU_FILTER = "Ht=Ht.filter(e=>e.id!==et.help),";
const LEGACY_NATIVE_HELP_MENU_BUILD = LEGACY_NATIVE_HELP_MENU_FILTER + UPSTREAM_NATIVE_HELP_MENU_BUILD;
const STACKED_NATIVE_HELP_MENU_BUILD = LEGACY_NATIVE_HELP_MENU_FILTER + BRANDED_NATIVE_HELP_MENU_BUILD;

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
  // Select the upstream page variant from branding.json. The product name and
  // Windows identity are patched independently below.
  packageJson.codexAppBrand = config.appBrand;
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
    `    <link rel="stylesheet" href="./forgecode-branding.css?v=${BRAND_ASSET_REVISION}" />`,
    `    <script defer src="./forgecode-branding.js?v=${BRAND_ASSET_REVISION}"></script>`,
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

  fs.copyFileSync(MARK_SOURCE, path.join(webviewDir, WEBVIEW_ICON_FILE_NAME));
  fs.copyFileSync(SMALL_MARK_SOURCE, path.join(webviewDir, WEBVIEW_SMALL_ICON_FILE_NAME));
  fs.copyFileSync(TITLEBAR_MARK_SOURCE, path.join(webviewDir, TITLEBAR_ICON_FILE_NAME));
  fs.copyFileSync(SHATTER_SOURCE, path.join(webviewDir, WEBVIEW_ANIMATION_FILE_NAME));
  const style = fs
    .readFileSync(STYLE_SOURCE, "utf-8")
    .replaceAll("__BRANDING_WEBVIEW_ICON__", WEBVIEW_ICON_FILE_NAME)
    .replaceAll("__BRANDING_THEME_MINT__", config.theme.mint)
    .replaceAll("__BRANDING_THEME_CORAL__", config.theme.coral)
    .replaceAll("__BRANDING_THEME_INK__", config.theme.ink);
  writeIfChanged(path.join(webviewDir, "forgecode-branding.css"), style);
  const script = fs
    .readFileSync(SCRIPT_SOURCE, "utf-8")
    .replace('"__FORGECODE_NAME__"', JSON.stringify(config.appName))
    .replace('"__FORGECODE_SIDEBAR_NAME__"', JSON.stringify(config.sidebarName))
    .replace('"__FORGECODE_HOME_GREETING__"', JSON.stringify(config.homeGreeting))
    .replace('"__BRANDING_WEBVIEW_ICON__"', JSON.stringify(WEBVIEW_ICON_FILE_NAME))
    .replace('"__BRANDING_TITLEBAR_ICON__"', JSON.stringify(TITLEBAR_ICON_FILE_NAME))
    .replace('"__BRANDING_ASSET_REVISION__"', JSON.stringify(config.assetRevision))
    .replace('"__BRANDING_WEBVIEW_ANIMATION__"', JSON.stringify(WEBVIEW_ANIMATION_FILE_NAME))
    .replace('__FORGECODE_HIDE_WINDOWS_SANDBOX_BANNER__', JSON.stringify(config.ui.hideWindowsSandboxBanner))
    .replace('__FORGECODE_HIDE_API_KEY_AUTH_MENU_ITEM__', JSON.stringify(config.ui.hideApiKeyAuthMenuItem))
    .replace('__FORGECODE_HIDE_LOGOUT_MENU_ITEM__', JSON.stringify(config.ui.hideLogoutMenuItem))
    .replace('__FORGECODE_HIDE_MODEL_REASONING_EFFORT__', JSON.stringify(config.ui.hideModelReasoningEffort))
    .replace('__FORGECODE_HIDE_SIDEBAR_PET_MENU_ITEM__', JSON.stringify(config.ui.hideSidebarPetMenuItem))
    .replace('__FORGECODE_HIDE_SIDEBAR_SETTINGS_MENU_ITEM__', JSON.stringify(config.ui.hideSidebarSettingsMenuItem))
    .replace('__FORGECODE_HIDE_SIDEBAR_HELP_BUTTON__', JSON.stringify(config.ui.hideSidebarHelpButton))
    .replace('"__FORGECODE_MODEL_PICKER_LABEL__"', JSON.stringify(config.ui.modelPickerLabel))
    .replace('__FORGECODE_HIDDEN_WINDOWS_SANDBOX_LABELS__', JSON.stringify(config.ui.hiddenWindowsSandboxLabels))
    .replace('__FORGECODE_HIDDEN_API_KEY_AUTH_LABELS__', JSON.stringify(config.ui.hiddenApiKeyAuthLabels))
    .replace('__FORGECODE_HIDDEN_LOGOUT_LABELS__', JSON.stringify(config.ui.hiddenLogoutLabels))
    .replace('__FORGECODE_HIDDEN_SIDEBAR_PET_LABELS__', JSON.stringify(config.ui.hiddenSidebarPetLabels))
    .replace('__FORGECODE_HIDDEN_SIDEBAR_SETTINGS_LABELS__', JSON.stringify(config.ui.hiddenSidebarSettingsLabels))
    .replace('__FORGECODE_HIDDEN_SIDEBAR_HELP_BUTTON_LABELS__', JSON.stringify(config.ui.hiddenSidebarHelpButtonLabels))
    .replace('__FORGECODE_HIDDEN_MODEL_REASONING_EFFORT_LABELS__', JSON.stringify(config.ui.hiddenModelReasoningEffortLabels))
    .replace('__FORGECODE_MODEL_PICKER_MODEL_LABELS__', JSON.stringify(config.ui.modelPickerModelLabels));
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

function replaceSinglePattern(source, pattern, replacement, label, filePath) {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`${relPath(filePath)}: expected one ${label} match, found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

function patchMainProcess(platform) {
  const buildDir = path.join(SRC_DIR, platform, "_asar", ".vite", "build");
  const bootstrapName = fs.readdirSync(buildDir).find((file) => /^bootstrap-.*\.js$/.test(file));
  const mainName = fs.readdirSync(buildDir).find((file) => {
    if (!/^main-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(buildDir, file), "utf-8");
    return source.includes("windowIconPath") && source.includes("globalState");
  });
  const sqliteName = fs.readdirSync(buildDir).find((file) => {
    if (!/^src-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(buildDir, file), "utf-8");
    return source.includes("`codex-dev.db`")
      || source.includes("`" + PREVIOUS_DEV_DATABASE_FILE_NAME + "`")
      || source.includes("`" + config.devDatabaseFileName + "`")
      || /`[^`]+-dev\.db`/.test(source);
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
    + windowsBranding.appUserModelId + ".dev`:`" + windowsBranding.appUserModelId + "`)";
  const upstreamWindowsTrayGuid = "case n.js.Prod:return`e5768d8b-6936-4f45-b1ad-4c5fb414cb35`";
  const brandedWindowsTrayGuid = "case n.js.Prod:return`" + windowsBranding.trayGuid + "`";
  const brandedAppDataPath = "a.app.setPath(`appData`,o.join(a.app.getPath(`appData`),`..`,`" + config.appName + "`))";
  const brandedCodeHome = config.homeDirectoryName;
  const invalidConfigRepairMarker = "forgecode-repair-invalid-config-utf8";
  const invalidConfigRepair = config.defaultConfig.repairInvalidUtf8OnStartup
    ? "let n=o.join(t,`config.toml`),r=c.existsSync(n)?c.readFileSync(n):null;if(r&&!require(`node:buffer`).isUtf8(r)){let e=Buffer.from(r.toString(`latin1`).split(/\\r?\\n/).filter(e=>!e.trimStart().startsWith(`#`)).join(`\\n`),`latin1`);require(`node:buffer`).isUtf8(e)&&c.writeFileSync(n,e)/*" + invalidConfigRepairMarker + "*/}"
    : "";
  const homeMigrationPrefix = "(()=>{let e=o.join(require(`node:os`).homedir(),`.forgecode`),t=o.join(require(`node:os`).homedir(),`";
  const homeMigration = "(()=>{let e=o.join(require(`node:os`).homedir(),`.forgecode`),t=o.join(require(`node:os`).homedir(),`"
    + brandedCodeHome + "`);process.env.CODEX_HOME=t,delete process.env.CODEX_ELECTRON_USER_DATA_PATH;try{c.mkdirSync(t,{recursive:!0});for(let n of [`auth.json`,`config.toml`]){let r=o.join(t,n);c.existsSync(r)||c.existsSync(o.join(e,n))&&(n===`config.toml`?c.writeFileSync(r,c.readFileSync(o.join(e,n),`utf8`).replaceAll(`.forgecode`,`"
    + brandedCodeHome + "`),`utf8`):c.copyFileSync(o.join(e,n),r))}" + invalidConfigRepair + "}catch(e){}})()";
  const upstreamSingleInstanceExit = "if(!(!$||a.app.requestSingleInstanceLock()))";
  const brandedSingleInstanceExit = "if(!(!$||!0))";
  const previousAppNameForBuildFlavor = "n===`dev`?`ForgeCode (Dev)`:`ForgeCode`";
  const previousAppNameForResolvedFlavor = "Z===`dev`?`ForgeCode (Dev)`:`ForgeCode`";
  if (bootstrap.includes("t.Ta(n)")) {
    bootstrap = replaceExact(bootstrap, "t.Ta(n)", appNameForBuildFlavor, "user-data app name", bootstrapPath);
  } else if (bootstrap.includes(previousAppNameForBuildFlavor)) {
    bootstrap = replaceExact(bootstrap, previousAppNameForBuildFlavor, appNameForBuildFlavor, "previous user-data app name", bootstrapPath);
  } else if (!bootstrap.includes(appNameForBuildFlavor)) {
    bootstrap = replaceSinglePattern(
      bootstrap,
      /n===`dev`\?`[^`]+`:`[^`]+`/g,
      appNameForBuildFlavor,
      "previous user-data app name",
      bootstrapPath,
    );
  }
  if (bootstrap.includes("t.Ta(Z,Q)")) {
    bootstrap = replaceExact(bootstrap, "t.Ta(Z,Q)", appNameForResolvedFlavor, "application name", bootstrapPath);
  } else if (bootstrap.includes(previousAppNameForResolvedFlavor)) {
    bootstrap = replaceExact(bootstrap, previousAppNameForResolvedFlavor, appNameForResolvedFlavor, "previous application name", bootstrapPath);
  } else if (!bootstrap.includes(appNameForResolvedFlavor)) {
    bootstrap = replaceSinglePattern(
      bootstrap,
      /a\.app\.setName\(Z===`dev`\?`[^`]+`:`[^`]+`\)/g,
      "a.app.setName(" + appNameForResolvedFlavor + ")",
      "previous application name",
      bootstrapPath,
    );
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
    bootstrap = replaceSinglePattern(
      bootstrap,
      /process\.platform===`win32`&&a\.app\.setAppUserModelId\(Z===`dev`\?`[^`]+`:`[^`]+`\)/g,
      brandedAppUserModelId,
      "previous Windows AppUserModelID",
      bootstrapPath,
    );
  }
  if (!bootstrap.includes(brandedAppDataPath)) {
    const existingAppDataPath = /a\.app\.setPath\(`appData`,o\.join\(a\.app\.getPath\(`appData`\),`\.\.`,`[^`]+`\)\)/g;
    if (existingAppDataPath.test(bootstrap)) {
      existingAppDataPath.lastIndex = 0;
      bootstrap = replaceSinglePattern(
        bootstrap,
        existingAppDataPath,
        brandedAppDataPath,
        "previous application data path",
        bootstrapPath,
      );
    } else {
      const appNameCall = "a.app.setName(" + appNameForResolvedFlavor + ")";
      if (!bootstrap.includes(appNameCall)) {
        throw new Error(`${relPath(bootstrapPath)}: application data path anchor was not recognized`);
      }
      bootstrap = replaceExact(
        bootstrap,
        appNameCall,
        appNameCall + "," + brandedAppDataPath + "," + homeMigration,
        "application data path",
        bootstrapPath,
      );
    }
  }
  if (!bootstrap.includes(homeMigration)) {
    const migrationStart = bootstrap.indexOf(homeMigrationPrefix);
    const migrationEnd = migrationStart === -1 ? -1 : bootstrap.indexOf("})()", migrationStart);
    if (migrationEnd === -1) {
      throw new Error(`${relPath(bootstrapPath)}: application home migration was not recognized`);
    }
    bootstrap = bootstrap.slice(0, migrationStart) + homeMigration + bootstrap.slice(migrationEnd + 4);
  }
  if (bootstrap.includes(upstreamSingleInstanceExit)) {
    bootstrap = replaceExact(
      bootstrap,
      upstreamSingleInstanceExit,
      brandedSingleInstanceExit,
      "single-instance exit branch",
      bootstrapPath,
    );
  } else if (!bootstrap.includes(brandedSingleInstanceExit)) {
    throw new Error(`${relPath(bootstrapPath)}: single-instance exit branch was not recognized`);
  }
  writeIfChanged(bootstrapPath, bootstrap);

  const mainPath = path.join(buildDir, mainName);
  let main = fs.readFileSync(mainPath, "utf-8");
  if (main.includes(upstreamWindowsTrayGuid)) {
    main = replaceExact(
      main,
      upstreamWindowsTrayGuid,
      brandedWindowsTrayGuid,
      "Windows tray GUID",
      mainPath,
    );
  } else if (!main.includes(brandedWindowsTrayGuid)) {
    throw new Error(`${relPath(mainPath)}: Windows tray GUID was not recognized`);
  }
  const upstreamWindowIconPath = "j=process.platform===`linux`?G5(i,e,T):null";
  const brandedWindowIconPath = "j=process.platform===`linux`?G5(i,e,T):process.platform===`win32`?(0,p.join)(process.resourcesPath,`"
    + windowsBranding.runtimeIconFileName + "`):null";
  const existingWindowIconPath = /j=process\.platform===`linux`\?G5\(i,e,T\):process\.platform===`win32`\?\(0,p\.join\)\(process\.resourcesPath,`[^`]+`\):null/g;
  if (main.includes(upstreamWindowIconPath)) {
    main = replaceExact(
      main,
      upstreamWindowIconPath,
      brandedWindowIconPath,
      "Windows window icon path",
      mainPath,
    );
  } else if (!main.includes(brandedWindowIconPath)) {
    main = replaceSinglePattern(
      main,
      existingWindowIconPath,
      brandedWindowIconPath,
      "previous Windows window icon path",
      mainPath,
    );
  }
  const upstreamWindowAppDetails = "webPreferences:j});this.applyWindowBackdrop(P,o,!0);let F=P.webContents";
  const brandedWindowAppDetails = "webPreferences:j});process.platform===`win32`&&P.setAppDetails?.({appId:`"
    + windowsBranding.appUserModelId
    + "`,appIconPath:this.options.windowIconPath??process.execPath,appIconIndex:0,relaunchCommand:(0,p.join)((0,p.dirname)(process.execPath),`"
    + windowsBranding.executableName + "`),relaunchDisplayName:`"
    + config.appName
    + "`}),this.applyWindowBackdrop(P,o,!0);let F=P.webContents";
  const existingWindowAppDetails = /process\.platform===`win32`&&([A-Za-z_$][\w$]*)\.setAppDetails\?\.\(\{appId:`[^`]+`,appIconPath:this\.options\.windowIconPath\?\?process\.execPath,appIconIndex:0,relaunchCommand:\(0,([A-Za-z_$][\w$]*)\.join\)\(\(0,\2\.dirname\)\(process\.execPath\),`([^`]+)`\),relaunchDisplayName:`[^`]+`\}\)/g;
  if (main.includes(upstreamWindowAppDetails)) {
    main = replaceExact(
      main,
      upstreamWindowAppDetails,
      brandedWindowAppDetails,
      "Windows window app details",
      mainPath,
    );
  } else if (!main.includes(brandedWindowAppDetails)) {
    main = replaceSinglePattern(
      main,
      existingWindowAppDetails,
      (_match, windowVariable, pathVariable) => "process.platform===`win32`&&"
        + windowVariable + ".setAppDetails?.({appId:`" + windowsBranding.appUserModelId
        + "`,appIconPath:this.options.windowIconPath??process.execPath,appIconIndex:0,relaunchCommand:(0,"
        + pathVariable + ".join)((0," + pathVariable + ".dirname)(process.execPath),`"
        + windowsBranding.executableName + "`),relaunchDisplayName:`" + config.appName + "`})",
      "previous Windows window app details",
      mainPath,
    );
  }

  if (config.ui.hideNativeHelpMenu) {
    if (main.includes(STACKED_NATIVE_HELP_MENU_BUILD)) {
      main = replaceExact(
        main,
        STACKED_NATIVE_HELP_MENU_BUILD,
        BRANDED_NATIVE_HELP_MENU_BUILD,
        "stacked native Help menu visibility",
        mainPath,
      );
    } else if (main.includes(LEGACY_NATIVE_HELP_MENU_BUILD)) {
      main = replaceExact(
        main,
        LEGACY_NATIVE_HELP_MENU_BUILD,
        BRANDED_NATIVE_HELP_MENU_BUILD,
        "legacy native Help menu visibility",
        mainPath,
      );
    } else if (main.includes(BRANDED_NATIVE_HELP_MENU_BUILD)) {
      // The bundle has already been patched for the configured native menu.
    } else if (main.includes(UPSTREAM_NATIVE_HELP_MENU_BUILD)) {
      main = replaceExact(
        main,
        UPSTREAM_NATIVE_HELP_MENU_BUILD,
        BRANDED_NATIVE_HELP_MENU_BUILD,
        "native Help menu visibility",
        mainPath,
      );
    } else {
      throw new Error(`${relPath(mainPath)}: native Help menu build was not recognized`);
    }
  }

  if (config.ui.hideNativeSettingsMenuItem) {
    const upstreamSettingsMenuAppend = "else process.platform===`win32`&&Wt&&(Wt.append(new l.MenuItem({type:`separator`})),Wt.append(new l.MenuItem(F)))";
    if (main.includes(upstreamSettingsMenuAppend)) {
      main = replaceExact(
        main,
        upstreamSettingsMenuAppend,
        "",
        "native Settings menu visibility",
        mainPath,
      );
    } else if (main.includes("Wt.append(new l.MenuItem(F))")) {
      throw new Error(`${relPath(mainPath)}: native Settings menu append was not recognized`);
    }
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
      const existingDevNames = [...sqlite.matchAll(/`([^`]+-dev\.db)`/g)].map((match) => match[1]);
      const existingProdNames = [...sqlite.matchAll(/`([^`]+\.db)`/g)]
        .map((match) => match[1])
        .filter((name) => !name.endsWith("-dev.db"));
      const uniqueProdNames = [...new Set(existingProdNames)];
      const uniqueDevNames = [...new Set(existingDevNames)];
      if (
        existingProdNames.length !== 2
        || existingDevNames.length !== 2
        || uniqueProdNames.length !== 1
        || uniqueDevNames.length !== 1
      ) {
        throw new Error(`${relPath(sqlitePath)}: unexpected SQLite filename match count`);
      }
      sqlite = sqlite.replaceAll("`" + uniqueProdNames[0] + "`", "`" + config.databaseFileName + "`");
      sqlite = sqlite.replaceAll("`" + uniqueDevNames[0] + "`", "`" + config.devDatabaseFileName + "`");
    }
  }
  const brandedHome = "i.join(r.homedir(),`" + brandedCodeHome + "`)";
  if ((sqlite.split(brandedHome).length - 1) !== 2) {
    const existingHomes = [...sqlite.matchAll(/i\.join\(r\.homedir\(\),`([^`]+)`\)/g)].map((match) => match[1]);
    const uniqueHomes = [...new Set(existingHomes)];
    if (existingHomes.length !== 2 || uniqueHomes.length !== 1) {
      throw new Error(`${relPath(sqlitePath)}: unexpected CODEX_HOME fallback match count`);
    }
    sqlite = sqlite.replaceAll(
      "i.join(r.homedir(),`" + uniqueHomes[0] + "`)",
      brandedHome,
    );
  }
  writeIfChanged(sqlitePath, sqlite);

  return [relPath(bootstrapPath), relPath(mainPath), relPath(sqlitePath)];
}

async function patchWindowsRuntimeIcon(platform) {
  if (platform !== "win") return null;

  const upstreamRuntimeExe = path.join(SRC_DIR, "win", "runtime", "ChatGPT.exe");
  const brandedRuntimeExe = path.join(SRC_DIR, "win", "runtime", windowsBranding.executableName);
  const notificationHelperExe = path.join(SRC_DIR, "win", "runtime", NOTIFICATION_HELPER_EXECUTABLE_NAME);
  const runtimeResourcesDir = path.join(SRC_DIR, "win", "runtime", "resources");
  const packagedResourcesIcon = path.join(SRC_DIR, "win", windowsBranding.runtimeIconFileName);
  const runtimeResourcesIcon = path.join(runtimeResourcesDir, windowsBranding.runtimeIconFileName);
  if (!fs.existsSync(upstreamRuntimeExe)) {
    throw new Error("win: runtime executable was not found");
  }

  // BrowserWindow loads this path for both the unpackaged runtime and a Forge
  // package. The latter receives the configured Windows icon through packageAfterCopy.
  fs.mkdirSync(runtimeResourcesDir, { recursive: true });
  patchWindowsRuntimeIdentity(WINDOWS_RUNTIME_INI);
  fs.copyFileSync(WINDOWS_ICON_SOURCE, runtimeResourcesIcon);
  fs.copyFileSync(WINDOWS_ICON_SOURCE, packagedResourcesIcon);
  for (const trayIcon of [
    "chatgpt-tray-light.ico",
    "chatgpt-tray-dark.ico",
    "icon-chatgpt.ico",
  ]) {
    fs.copyFileSync(WINDOWS_ICON_SOURCE, path.join(runtimeResourcesDir, trayIcon));
  }

  // Windows keeps taskbar icon associations per executable path. Running the
  // branded copy avoids retaining the upstream ChatGPT.exe icon from Shell's
  // cache while preserving the extracted runtime as an untouched base.
  if (!fs.existsSync(brandedRuntimeExe)) {
    fs.copyFileSync(upstreamRuntimeExe, brandedRuntimeExe);
  }

  await brandWindowsExecutable(brandedRuntimeExe, WINDOWS_ICON_SOURCE, {
    ProductName: config.appName,
    FileDescription: `${config.appName} Desktop`,
    CompanyName: config.author,
    OriginalFilename: windowsBranding.executableName,
  });
  if (fs.existsSync(notificationHelperExe)) {
    await brandWindowsExecutable(notificationHelperExe, WINDOWS_ICON_SOURCE, {
      ProductName: config.appName,
      FileDescription: `${config.appName} Notification Helper`,
      CompanyName: config.author,
      OriginalFilename: NOTIFICATION_HELPER_EXECUTABLE_NAME,
    });
  }
  return relPath(brandedRuntimeExe);
}

function patchWindowsRuntimeIdentity(iniPath) {
  if (!fs.existsSync(iniPath)) {
    throw new Error(`win: Owl runtime configuration was not found: ${relPath(iniPath)}`);
  }

  const upstream = "UserDataDirectoryName=Codex";
  const branded = `UserDataDirectoryName=${WINDOWS_RUNTIME_USER_DATA_NAME}`;
  const source = fs.readFileSync(iniPath, "utf-8");
  if (source.includes(upstream)) {
    writeIfChanged(iniPath, replaceExact(source, upstream, branded, "Owl runtime identity", iniPath));
  } else if (!source.includes(branded)) {
    writeIfChanged(
      iniPath,
      replaceSinglePattern(
        source,
        /UserDataDirectoryName=[^\r\n]+/g,
        branded,
        "previous Owl runtime identity",
        iniPath,
      ),
    );
  }
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
  onboarding = onboarding.replace(
    /((?:defaultMessage|description):`(?:\\.|[^`])*`)/g,
    (value) => value
      .replaceAll("ChatGPT", config.appName)
      .replaceAll("Codex", config.appName),
  );
  const headerIconMarker = '"data-branding-onboarding-header-icon":!0';
  const brandedHeaderIcon = "`img`,{alt:``,\"aria-hidden\":!0,className:`block size-full object-contain`,"
    + headerIconMarker + ",draggable:!1,src:`./" + TITLEBAR_ICON_FILE_NAME + "`}";
  if (onboarding.includes(headerIconMarker)) {
    onboarding = replaceSinglePattern(
      onboarding,
      /(`img`,\{alt:``,"aria-hidden":!0,className:`block size-full object-contain`,"data-branding-onboarding-header-icon":!0,draggable:!1,src:)`\.\/[^`]+`/g,
      "$1`./" + TITLEBAR_ICON_FILE_NAME + "`",
      "previous onboarding header brand icon",
      onboardingPath,
    );
  } else {
    onboarding = replaceSinglePattern(
      onboarding,
      /\(0,([A-Za-z_$][\w$]*)\.jsx\)\(([A-Za-z_$][\w$]*),\{className:`block size-full`\}\)/g,
      (_match, jsxNamespace) => "(0," + jsxNamespace + ".jsx)(" + brandedHeaderIcon + ")",
      "onboarding header brand icon",
      onboardingPath,
    );
  }
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

function patchAppBrandIcon(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const appInitialName = fs.readdirSync(assetsDir).find((file) => {
    if (!/^app-initial-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(assetsDir, file), "utf-8");
    return source.includes("function Mjo") || source.includes("src:Ojo");
  });
  if (!appInitialName) {
    throw new Error(`${platform}: could not locate the shared app brand icon component`);
  }

  const appInitialPath = path.join(assetsDir, appInitialName);
  let source = fs.readFileSync(appInitialPath, "utf-8");
  const upstream = "(0,Pjo.jsx)(Ajo,{\"aria-hidden\":`true`,className:r})";
  const branded = "(0,Pjo.jsx)(`img`,{alt:``,\"aria-hidden\":!0,className:r,draggable:!1,src:`./"
    + WEBVIEW_ICON_FILE_NAME + "`})";

  if (source.includes(upstream)) {
    source = replaceExact(source, upstream, branded, "ChatGPT app brand icon", appInitialPath);
  } else if (!source.includes("src:`./" + WEBVIEW_ICON_FILE_NAME + "`")) {
    const genericUpstream = /\(0,([A-Za-z_$][\w$]*)\.jsx\)\(([A-Za-z_$][\w$]*),\{\"aria-hidden\":`true`,className:r\}\)/g;
    source = replaceSinglePattern(
      source,
      genericUpstream,
      (_match, jsxNamespace) => "(0," + jsxNamespace + ".jsx)(`img`,{alt:``,\"aria-hidden\":!0,className:r,draggable:!1,src:`./"
        + WEBVIEW_ICON_FILE_NAME + "`})",
      "previous ChatGPT app brand icon",
      appInitialPath,
    );
  }
  source = source.replaceAll("src:Ojo", "src:`./" + WEBVIEW_ICON_FILE_NAME + "`");
  writeIfChanged(appInitialPath, source);
  return relPath(appInitialPath);
}

function findRendererAppBrand(source) {
  const pattern = /([A-Za-z_$][\w$]*)=`(chatgpt|codex)`,([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\1\)/g;
  const matches = [...source.matchAll(pattern)];
  return matches.length === 1 ? matches[0] : null;
}

function patchRendererAppBrand(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const appInitialName = fs.readdirSync(assetsDir).find((file) =>
    /^app-initial-.*\.js$/.test(file),
  );
  if (!appInitialName) {
    throw new Error(`${platform}: could not locate the renderer app bundle`);
  }

  const appInitialPath = path.join(assetsDir, appInitialName);
  let source = fs.readFileSync(appInitialPath, "utf-8");
  const match = findRendererAppBrand(source);
  if (!match) {
    throw new Error(`${relPath(appInitialPath)}: renderer app brand constant was not recognized`);
  }

  const [upstream, brandVariable, , labelVariable, formatBrand] = match;
  const branded = `${brandVariable}=\`${config.appBrand}\`,${labelVariable}=${formatBrand}(${brandVariable})`;
  source = source.replace(upstream, branded);
  writeIfChanged(appInitialPath, source);
  return relPath(appInitialPath);
}

function findRendererProductMode(source) {
  const pattern = /function ([A-Za-z_$][\w$]*)\(\{configuredThreadDetailLevel:([A-Za-z_$][\w$]*),onboardingWorkMode:([A-Za-z_$][\w$]*),threadDetailLevel:([A-Za-z_$][\w$]*)\}\)\{return([^{}]+)\}/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) return null;

  const fixedMode = /^`(codex|work)`$/.exec(matches[0][5])?.[1] ?? null;
  return { fixedMode, match: matches[0] };
}

function findRendererDetailMode(source) {
  const constantsPattern = /([A-Za-z_$][\w$]*)=`STEPS_PROSE`,([A-Za-z_$][\w$]*)=`STEPS_COMMANDS`/g;
  const constantsMatches = [...source.matchAll(constantsPattern)];
  if (constantsMatches.length !== 1) return null;

  const [, proseVariable, commandsVariable] = constantsMatches[0];
  const fixedPattern = new RegExp(
    `([A-Za-z_$][\\w$]*)=ja\\(Q,\\(\\)=>(${proseVariable}|${commandsVariable})\\)`,
    "g",
  );
  const fixedMatches = [...source.matchAll(fixedPattern)];
  if (fixedMatches.length === 1) {
    return {
      atomVariable: fixedMatches[0][1],
      commandsVariable,
      currentMode: fixedMatches[0][2] === commandsVariable ? "codex" : "work",
      match: fixedMatches[0],
      proseVariable,
    };
  }

  const upstreamPattern = /([A-Za-z_$][\w$]*)=ja\(Q,\(\{get:[A-Za-z_$][\w$]*\}\)=>\{[^{}]*unsupported-auth[^{}]*\}\)/g;
  const upstreamMatches = [...source.matchAll(upstreamPattern)];
  if (upstreamMatches.length !== 1) return null;
  return {
    atomVariable: upstreamMatches[0][1],
    commandsVariable,
    currentMode: null,
    match: upstreamMatches[0],
    proseVariable,
  };
}

function patchRendererProductMode(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const appInitialName = fs.readdirSync(assetsDir).find((file) =>
    /^app-initial-.*\.js$/.test(file),
  );
  if (!appInitialName) {
    throw new Error(`${platform}: could not locate the renderer app bundle`);
  }

  const appInitialPath = path.join(assetsDir, appInitialName);
  let source = fs.readFileSync(appInitialPath, "utf-8");
  const productMode = findRendererProductMode(source);
  if (!productMode) {
    throw new Error(`${relPath(appInitialPath)}: renderer product mode selector was not recognized`);
  }

  const [upstream, functionName, configuredLevel, onboardingMode, threadLevel] = productMode.match;
  const branded = `function ${functionName}({configuredThreadDetailLevel:${configuredLevel},onboardingWorkMode:${onboardingMode},threadDetailLevel:${threadLevel}}){return\`${config.productMode}\`}`;
  source = source.replace(upstream, branded);

  const detailMode = findRendererDetailMode(source);
  if (!detailMode) {
    throw new Error(`${relPath(appInitialPath)}: renderer conversation detail mode was not recognized`);
  }
  const detailVariable = config.productMode === "codex"
    ? detailMode.commandsVariable
    : detailMode.proseVariable;
  const brandedDetailMode = `${detailMode.atomVariable}=ja(Q,()=>${detailVariable})`;
  source = source.replace(detailMode.match[0], brandedDetailMode);

  writeIfChanged(appInitialPath, source);
  return relPath(appInitialPath);
}

function patchRendererWindowsSandboxBanner(platform) {
  if (!config.ui.hideWindowsSandboxBanner) return null;

  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const appInitialName = fs.readdirSync(assetsDir).find((file) =>
    /^app-initial-.*\.js$/.test(file),
  );
  if (!appInitialName) {
    throw new Error(`${platform}: could not locate the renderer app bundle`);
  }

  const appInitialPath = path.join(assetsDir, appInitialName);
  let source = fs.readFileSync(appInitialPath, "utf-8");
  const upstream = "u=!n&&i?(0,djs.jsx)(njs,{cwd:a===`/`||o?null:a,requirement:s,setShowWindowsSandboxBanner:c}):null";
  const marker = "forgecode-hide-windows-sandbox-banner";
  const branded = `u=!1/*${marker}*/`;
  if (source.includes(upstream)) {
    source = replaceExact(source, upstream, branded, "Windows sandbox status banner", appInitialPath);
  } else if (!source.includes(marker)) {
    throw new Error(`${relPath(appInitialPath)}: Windows sandbox status banner was not recognized`);
  }
  writeIfChanged(appInitialPath, source);
  return relPath(appInitialPath);
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
  const brandedIcon = "a=r===void 0?e=>(0,pir.jsx)(`img`,{src:`./"
    + WEBVIEW_ICON_FILE_NAME + "`,alt:``,\"data-forgecode-startup-icon\":!0,...e}):r";
  const upstreamMask = "o=i===void 0?mir:i";
  const brandedMask = "o=i===void 0?`./" + WEBVIEW_ICON_FILE_NAME + "`:i";

  if (source.includes(upstreamIcon)) {
    source = replaceExact(source, upstreamIcon, brandedIcon, "webview startup icon", appInitialPath);
    source = replaceExact(source, upstreamMask, brandedMask, "webview startup mask", appInitialPath);
  } else if (source.includes("data-forgecode-startup-icon")) {
    source = source
      .replaceAll("./forgecode-mark.svg", "./" + WEBVIEW_ICON_FILE_NAME)
      .replaceAll("./aigeek-mark.png", "./" + WEBVIEW_ICON_FILE_NAME);
  } else {
    throw new Error(`${relPath(appInitialPath)}: webview startup logo was not recognized`);
  }
  writeIfChanged(appInitialPath, source);
  return relPath(appInitialPath);
}

function patchDesktopNotificationReplyPlaceholder(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const appInitialName = fs.readdirSync(assetsDir).find((file) => {
    if (!/^app-initial-.*\.js$/.test(file)) return false;
    const source = fs.readFileSync(path.join(assetsDir, file), "utf-8");
    return source.includes("replyPlaceholder:`Reply to ChatGPT`")
      || source.includes("replyPlaceholder:`Reply`");
  });
  if (!appInitialName) {
    throw new Error(`${platform}: could not locate the desktop notification bundle`);
  }

  const appInitialPath = path.join(assetsDir, appInitialName);
  let source = fs.readFileSync(appInitialPath, "utf-8");
  const upstream = "replyPlaceholder:`Reply to ChatGPT`";
  const branded = "replyPlaceholder:`Reply`";
  if (source.includes(upstream)) {
    source = replaceExact(
      source,
      upstream,
      branded,
      "desktop notification reply placeholder",
      appInitialPath,
    );
  } else if (!source.includes(branded)) {
    throw new Error(`${relPath(appInitialPath)}: desktop notification reply placeholder was not recognized`);
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
  const branded = "\"composer.placeholder.workWithChatGPT\":`使用 " + config.appName + "`";

  if (source.includes(upstream)) {
    source = replaceExact(source, upstream, branded, "Chinese composer placeholder", localePath);
  } else if (!source.includes(branded)) {
    source = replaceSinglePattern(
      source,
      /"composer\.placeholder\.workWithChatGPT":`使用 [^`]+`/g,
      branded,
      "previous Chinese composer placeholder",
      localePath,
    );
  }
  writeIfChanged(localePath, source);
  return relPath(localePath);
}

function patchLocaleBrandNames(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const patched = [];

  for (const file of fs.readdirSync(assetsDir).filter((name) => {
    if (!/\.js$/.test(name)) return false;
    const source = fs.readFileSync(path.join(assetsDir, name), "utf-8");
    return source.includes('"CopyButton.copyTooltip":');
  })) {
    const filePath = path.join(assetsDir, file);
    const source = fs.readFileSync(filePath, "utf-8");
    // Locale bundles store translated values as object values after a colon.
    // Restrict replacement to those values so message IDs such as
    // composer.placeholder.workWithChatGPT remain compatible with the app.
    const next = source.replace(
      /(:`(?:\\.|[^`])*`)/g,
      (value) => value.replaceAll("ChatGPT", config.appName),
    ).replace(
      /(\"electron\.onboarding\.welcomeV2\.[^\"]+\":`(?:\\.|[^`])*`)/g,
      (value) => value.replaceAll("Codex", config.appName),
    );
    if (next !== source) {
      writeIfChanged(filePath, next);
      patched.push(relPath(filePath));
    }
  }

  return patched;
}

async function main() {
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
      const brandingScriptPath = path.join(asarDir, "webview", "forgecode-branding.js");
      const brandingScript = fs.existsSync(brandingScriptPath)
        ? fs.readFileSync(brandingScriptPath, "utf-8")
        : "";
      const modelReasoningVisibilityReady = brandingScript.includes(
        `hideModelReasoningEffort: ${JSON.stringify(config.ui.hideModelReasoningEffort)}`,
      );
      const sidebarVisibilityReady = brandingScript.includes(
        `hideSidebarPetMenuItem: ${JSON.stringify(config.ui.hideSidebarPetMenuItem)}`,
      ) && brandingScript.includes(
        `hideSidebarSettingsMenuItem: ${JSON.stringify(config.ui.hideSidebarSettingsMenuItem)}`,
      ) && brandingScript.includes(
        `hideSidebarHelpButton: ${JSON.stringify(config.ui.hideSidebarHelpButton)}`,
      );
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
      const invalidConfigRepairReady = !config.defaultConfig.repairInvalidUtf8OnStartup
        || bootstrap.includes("forgecode-repair-invalid-config-utf8");
      const mainName = fs.readdirSync(buildDir).find((file) => {
        if (!/^main-.*\.js$/.test(file)) return false;
        const source = fs.readFileSync(path.join(buildDir, file), "utf-8");
        return source.includes("windowIconPath") && source.includes("globalState");
      });
      const mainSource = mainName ? fs.readFileSync(path.join(buildDir, mainName), "utf-8") : "";
      const nativeHelpVisibilityReady = !config.ui.hideNativeHelpMenu
        || (
          mainSource.includes(BRANDED_NATIVE_HELP_MENU_BUILD)
          && !mainSource.includes(LEGACY_NATIVE_HELP_MENU_BUILD)
          && !mainSource.includes(STACKED_NATIVE_HELP_MENU_BUILD)
        );
      const nativeSettingsVisibilityReady = !config.ui.hideNativeSettingsMenuItem
        || !mainSource.includes("Wt.append(new l.MenuItem(F))");
      const sqlite = sqliteName ? fs.readFileSync(path.join(buildDir, sqliteName), "utf-8") : "";
      const onboarding = onboardingName
        ? fs.readFileSync(path.join(asarDir, "webview", "assets", onboardingName), "utf-8")
        : "";
      const appInitial = appInitialName
        ? fs.readFileSync(path.join(asarDir, "webview", "assets", appInitialName), "utf-8")
        : "";
      const rendererAppBrand = findRendererAppBrand(appInitial)?.[2] ?? null;
      const rendererProductMode = findRendererProductMode(appInitial)?.fixedMode ?? null;
      const rendererDetailMode = findRendererDetailMode(appInitial)?.currentMode ?? null;
      const rendererWindowsSandboxBanner = appInitial.includes("forgecode-hide-windows-sandbox-banner");
      const locale = localeName
        ? fs.readFileSync(path.join(asarDir, "webview", "assets", localeName), "utf-8")
        : "";
      const notificationHelperReady = !fs.existsSync(
        path.join(SRC_DIR, "win", "runtime", NOTIFICATION_HELPER_EXECUTABLE_NAME),
      ) || await windowsExecutableHasPrimaryIcon(
        path.join(SRC_DIR, "win", "runtime", NOTIFICATION_HELPER_EXECUTABLE_NAME),
        WINDOWS_ICON_SOURCE,
      );
      const runtimeReady = target !== "win"
      || (fs.existsSync(WINDOWS_RUNTIME_INI)
          && fs.readFileSync(WINDOWS_RUNTIME_INI, "utf-8").includes(`UserDataDirectoryName=${WINDOWS_RUNTIME_USER_DATA_NAME}`)
          && await windowsExecutableHasPrimaryIcon(
            path.join(SRC_DIR, "win", "runtime", windowsBranding.executableName),
            WINDOWS_ICON_SOURCE,
          )
          && notificationHelperReady);
      const ready = packageJson.productName === config.appName
        && packageJson.codexAppBrand === config.appBrand
        && rendererAppBrand === config.appBrand
        && rendererProductMode === config.productMode
        && rendererDetailMode === config.productMode
        && (!config.ui.hideWindowsSandboxBanner || rendererWindowsSandboxBanner)
        && index.includes(BLOCK_START)
        && index.includes(`forgecode-branding.js?v=${BRAND_ASSET_REVISION}`)
        && brandingScript.includes(TITLEBAR_ICON_FILE_NAME)
        && brandingScript.includes(config.assetRevision)
        && modelReasoningVisibilityReady
        && sidebarVisibilityReady
        && nativeHelpVisibilityReady
        && nativeSettingsVisibilityReady
        && fs.existsSync(path.join(asarDir, "webview", TITLEBAR_ICON_FILE_NAME))
        && bootstrap.includes(config.devAppName)
        && bootstrap.includes(windowsBranding.appUserModelId)
        && invalidConfigRepairReady
        && (target !== "win"
          || (mainSource.includes("setAppDetails")
            && mainSource.includes("appId:`" + windowsBranding.appUserModelId + "`")))
        && sqlite.includes(config.devDatabaseFileName)
        && sqlite.includes(config.homeDirectoryName)
        && onboarding.includes("__forgecodeOnboardingSkipped")
        && onboarding.includes("Customize " + config.appName)
        && onboarding.includes('"data-branding-onboarding-header-icon":!0')
        && onboarding.includes("src:`./" + TITLEBAR_ICON_FILE_NAME + "`")
        && appInitial.includes("data-forgecode-startup-icon")
        && appInitial.includes("src:`./" + WEBVIEW_ICON_FILE_NAME + "`")
        && appInitial.includes("replyPlaceholder:`Reply`")
        && locale.includes("\"composer.placeholder.workWithChatGPT\":`使用 " + config.appName + "`");
      console.log(`  [${target}] ${ready && runtimeReady ? "ready" : "needs patch"}`);
      if (!ready || !runtimeReady) process.exitCode = 1;
      continue;
    }

    console.log(`  [${target}] ${patchPackage(target)}`);
    console.log(`  [${target}] ${patchWebview(target)}`);
    for (const filePath of patchMainProcess(target)) {
      console.log(`  [${target}] ${filePath}`);
    }
    const runtimeIconPath = await patchWindowsRuntimeIcon(target);
    if (runtimeIconPath) console.log(`  [${target}] ${runtimeIconPath}`);
    console.log(`  [${target}] ${patchOnboarding(target)}`);
    console.log(`  [${target}] ${patchRendererAppBrand(target)}`);
    console.log(`  [${target}] ${patchRendererProductMode(target)}`);
    const sandboxBannerPath = patchRendererWindowsSandboxBanner(target);
    if (sandboxBannerPath) console.log(`  [${target}] ${sandboxBannerPath}`);
    console.log(`  [${target}] ${patchAppBrandIcon(target)}`);
    console.log(`  [${target}] ${patchWebviewStartupLogo(target)}`);
    console.log(`  [${target}] ${patchDesktopNotificationReplyPlaceholder(target)}`);
    console.log(`  [${target}] ${patchLocaleBrandCopy(target)}`);
    for (const filePath of patchLocaleBrandNames(target)) {
      console.log(`  [${target}] ${filePath}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
