#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const home = os.homedir();
const sourceDir = path.join(home, ".forgecode");
const targetDir = path.join(home, ".aigeek");

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of ["auth.json", "config.toml"]) {
  const source = path.join(sourceDir, fileName);
  const target = path.join(targetDir, fileName);
  if (fs.existsSync(target) || !fs.existsSync(source)) continue;

  if (fileName === "config.toml") {
    const config = fs.readFileSync(source, "utf-8").replaceAll(".forgecode", ".aigeek");
    fs.writeFileSync(target, config, "utf-8");
  } else {
    fs.copyFileSync(source, target);
  }
  console.log(`[aigeek-home] seeded ${fileName}`);
}
