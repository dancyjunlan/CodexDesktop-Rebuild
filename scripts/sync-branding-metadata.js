#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { PROJECT_ROOT, branding } = require("./branding-config");

function syncBrandingMetadata() {
  const packagePath = path.join(PROJECT_ROOT, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
  const next = {
    ...packageJson,
    name: branding.packageName,
    productName: branding.appName,
    author: branding.author,
    description: branding.description,
    codexAppBrand: branding.appBrand,
  };
  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (fs.readFileSync(packagePath, "utf-8") !== serialized) {
    fs.writeFileSync(packagePath, serialized, "utf-8");
    console.log("[branding] synchronized package.json metadata");
  }
}

if (require.main === module) syncBrandingMetadata();

module.exports = { syncBrandingMetadata };
