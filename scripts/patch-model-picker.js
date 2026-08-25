#!/usr/bin/env node
/**
 * Post-build patch: present one branded model while retaining the configured
 * model ID and its reasoning-effort capabilities.
 *
 * The renderer receives every model advertised by the local app server. The
 * picker keeps every model advertised by the local app server, while replacing
 * the active model's display name from branding.json. Selecting an option
 * therefore submits the selected model instead of trapping the picker on the
 * current config model.
 */
const fs = require("fs");
const path = require("path");
const { relPath, SRC_DIR } = require("./patch-util");
const { branding } = require("./branding-config");

const MODEL_LIST_MARKER = ",b=v?.models;";
const MODEL_LIST_REPLACEMENT = `,b=v?.models?.map(e=>({...e,displayName:e.model===_?\`${branding.ui.modelDisplayName}\`:e.displayName,isDefault:e.model===_}));`;
const PREVIOUS_MODEL_LIST_REPLACEMENT =
  ",b=v?.models?.filter(e=>e.model===_).map(e=>({...e,displayName:`glm-5.2`,isDefault:!0}));";
const PATCHED_MODEL_LIST_MARKER = "v?.models?.map(e=>({...e,displayName:e.model===_?";

const POWER_FALLBACK_MARKER =
  "let i=Lms(Vms.filter(({reasoningEffort:e})=>!n||e!==`xhigh`),e);return i.length>=3?i:[]";
const POWER_FALLBACK_REPLACEMENT =
  "let i=Lms(Vms.filter(({reasoningEffort:e})=>!n||e!==`xhigh`),e);return i.length>=3?i:Nms(e)";
const PATCHED_POWER_FALLBACK_MARKER = "return i.length>=3?i:Nms(e)";

function replaceOnce(source, marker, replacement) {
  const index = source.indexOf(marker);
  if (index === -1) return { code: source, changed: false };
  return {
    code: source.slice(0, index) + replacement + source.slice(index + marker.length),
    changed: true,
  };
}

function findTargets(platform) {
  const platforms = platform
    ? [platform]
    : ["mac-arm64", "mac-x64", "win"].filter((name) =>
        fs.existsSync(path.join(SRC_DIR, name, "_asar", "webview", "assets")),
      );

  const targets = [];
  for (const name of platforms) {
    const assetsDir = path.join(SRC_DIR, name, "_asar", "webview", "assets");
    if (!fs.existsSync(assetsDir)) continue;

    for (const fileName of fs.readdirSync(assetsDir)) {
      if (!fileName.endsWith(".js")) continue;
      const filePath = path.join(assetsDir, fileName);
      const source = fs.readFileSync(filePath, "utf8");
      if (
        source.includes(MODEL_LIST_MARKER)
        || source.includes(PREVIOUS_MODEL_LIST_REPLACEMENT)
        || source.includes(POWER_FALLBACK_MARKER)
        || source.includes(PATCHED_MODEL_LIST_MARKER)
        || source.includes(PATCHED_POWER_FALLBACK_MARKER)
      ) {
        targets.push({ platform: name, path: filePath });
      }
    }
  }
  return targets;
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const targets = findTargets(platform);

  if (targets.length === 0) {
    console.log("  [skip] No model-picker bundle matched");
    return;
  }

  let total = 0;
  for (const target of targets) {
    const source = fs.readFileSync(target.path, "utf8");
    const modelList = source.includes(MODEL_LIST_MARKER)
      ? replaceOnce(source, MODEL_LIST_MARKER, MODEL_LIST_REPLACEMENT)
      : replaceOnce(source, PREVIOUS_MODEL_LIST_REPLACEMENT, MODEL_LIST_REPLACEMENT);
    const powerFallback = replaceOnce(
      modelList.code,
      POWER_FALLBACK_MARKER,
      POWER_FALLBACK_REPLACEMENT,
    );
    const patches = Number(modelList.changed) + Number(powerFallback.changed);

    if (patches === 0) {
      console.log(`  [${target.platform}] ${relPath(target.path)} already patched`);
      continue;
    }

    console.log(`  [${target.platform}] ${relPath(target.path)}: ${patches} patch(es)`);
    if (!isCheck) fs.writeFileSync(target.path, powerFallback.code, "utf8");
    total += patches;
  }

  console.log(`  [ok] ${isCheck ? "would apply" : "applied"} ${total} model-picker patch(es)`);
}

main();
