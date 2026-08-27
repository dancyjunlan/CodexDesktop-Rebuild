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

function extractMcpServerSections(source, sectionName) {
  const rootHeader = `mcp_servers.${sectionName}`;
  const lines = source.split(/\r?\n/);
  const sectionLines = [];
  let collecting = false;

  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (header) {
      const belongsToServer = header === rootHeader || header.startsWith(`${rootHeader}.`);
      if (collecting && !belongsToServer) break;
      if (belongsToServer) collecting = true;
    }
    if (collecting) sectionLines.push(line);
  }

  return sectionLines.join("\n").replace(/\n+$/, "");
}

function hasMcpServerSection(source, sectionName) {
  const rootHeader = `[mcp_servers.${sectionName}]`;
  return source.split(/\r?\n/).some((line) => line.trim() === rootHeader);
}

function appendMissingMcpServerConfig(source, seedConfig, sectionName) {
  if (hasMcpServerSection(source, sectionName)) return source;

  const sections = extractMcpServerSections(seedConfig, sectionName);
  if (!sections) return source;

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalizedSections = sections.replaceAll("\n", newline);
  const separator = source.length === 0 || source.endsWith(newline) ? "" : newline;
  return `${source}${separator}${newline}${normalizedSections}${newline}`;
}

function prepareHomeConfigText({ sourcePath, branding }) {
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
  return config;
}

function prepareHomeConfig({ sourcePath, destinationPath, branding }) {
  fs.writeFileSync(destinationPath, prepareHomeConfigText({ sourcePath, branding }), "utf-8");
}

module.exports = {
  HOME_TOOLS_TOKEN,
  appendMissingMcpServerConfig,
  extractMcpServerSections,
  hasMcpServerSection,
  prepareHomeConfig,
  prepareHomeConfigText,
};
