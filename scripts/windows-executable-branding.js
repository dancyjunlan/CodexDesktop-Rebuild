const fs = require("fs");
const PELibrary = require("pe-library");
const { load: loadResEdit } = require("resedit/cjs");

const resEditPromise = loadResEdit();

function isPrimaryIconGroup(group) {
  return group.id === "IDR_MAINFRAME" || group.id === 1;
}

function primaryIconGroupsMatch(ResEdit, resources, iconFile) {
  const groups = ResEdit.Resource.IconGroupEntry
    .fromEntries(resources.entries)
    .filter(isPrimaryIconGroup);
  if (groups.length === 0 || groups.some((group) => group.icons.length !== iconFile.icons.length)) {
    return false;
  }

  return groups.every((group) => group.icons.every((icon, index) => {
    const resource = resources.entries.find((entry) =>
      entry.type === 3 && entry.id === icon.iconID && entry.lang === group.lang);
    const expected = iconFile.icons[index]?.data?.bin;
    return resource != null
      && expected != null
      && Buffer.from(resource.bin).equals(Buffer.from(expected));
  }));
}

async function windowsExecutableHasPrimaryIcon(exePath, iconPath) {
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) return false;
  const ResEdit = await resEditPromise;
  try {
    const executable = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
    const resources = PELibrary.NtExecutableResource.from(executable);
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
    return primaryIconGroupsMatch(ResEdit, resources, iconFile);
  } catch {
    return false;
  }
}

async function brandWindowsExecutable(exePath, iconPath, versionStrings = {}) {
  const ResEdit = await resEditPromise;
  const source = fs.readFileSync(exePath);
  const executable = PELibrary.NtExecutable.from(source, { ignoreCert: true });
  const resources = PELibrary.NtExecutableResource.from(executable);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const existingPrimaryGroups = ResEdit.Resource.IconGroupEntry
    .fromEntries(resources.entries)
    .filter(isPrimaryIconGroup);
  const primaryGroups = existingPrimaryGroups.length > 0
    ? existingPrimaryGroups
    : [{ id: 1, lang: 1033 }];

  for (const group of primaryGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      iconFile.icons.map((item) => item.data),
    );
  }

  for (const versionInfo of ResEdit.Resource.VersionInfo.fromEntries(resources.entries)) {
    const languages = versionInfo.getAllLanguagesForStringValues();
    for (const language of languages) {
      versionInfo.setStringValues(language, versionStrings, false);
    }
    versionInfo.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(executable);
  const output = Buffer.from(executable.generate());
  fs.writeFileSync(exePath, output);

  const verifiedExecutable = PELibrary.NtExecutable.from(output);
  const verifiedResources = PELibrary.NtExecutableResource.from(verifiedExecutable);
  if (!primaryIconGroupsMatch(ResEdit, verifiedResources, iconFile)) {
    throw new Error(`${exePath}: Windows icon replacement verification failed`);
  }
}

module.exports = { brandWindowsExecutable, windowsExecutableHasPrimaryIcon };
