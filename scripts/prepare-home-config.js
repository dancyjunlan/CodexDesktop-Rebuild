const fs = require("fs");
const { TextDecoder } = require("util");

const HOME_TOOLS_TOKEN = "__BRANDING_HOME_TOOLS__";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTomlKeyInSection(source, sectionName, key, value) {
  const header = `[mcp_servers.${sectionName}]`;
  const sectionStart = source.indexOf(header);
  if (sectionStart === -1) {
    throw new Error(`Config section is missing: ${header}`);
  }

  const nextSection = source.indexOf("\n[", sectionStart + header.length);
  const sectionEnd = nextSection === -1 ? source.length : nextSection;
  const section = source.slice(sectionStart, sectionEnd);
  const keyPattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, "m");
  if (!keyPattern.test(section)) {
    throw new Error(`Config key is missing: ${header}.${key}`);
  }

  const tomlLine = `${key} = "${value}"`;
  const updatedSection = section.replace(keyPattern, (match) =>
    tomlLine + (match.endsWith("\r") ? "\r" : ""),
  );
  return source.slice(0, sectionStart) + updatedSection + source.slice(sectionEnd);
}

function prepareHomeConfig({ sourcePath, destinationPath, branding }) {
  const mcp = branding.bundledMcpServer;
  const toTomlPath = (relativePath) =>
    `${HOME_TOOLS_TOKEN}\\\\${relativePath.replaceAll("\\", "\\\\")}`;
  let config;
  try {
    config = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(sourcePath));
  } catch {
    throw new Error(`${sourcePath} must contain valid UTF-8 text.`);
  }
  config = replaceTomlKeyInSection(config, mcp.section, "command", toTomlPath(mcp.commandPath));
  config = replaceTomlKeyInSection(config, mcp.section, "cwd", toTomlPath(mcp.cwdPath));
  if (branding.defaultConfig.stripInstallerComments) {
    config = config.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
  }
  fs.writeFileSync(destinationPath, config, "utf-8");
}

module.exports = { HOME_TOOLS_TOKEN, prepareHomeConfig };
