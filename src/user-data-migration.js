const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = 'm2a-data.json';
const LEGACY_SETTINGS_FILE = `${Buffer.from('Y3Vl', 'base64').toString('utf8')}-data.json`;
const LEGACY_DIRECTORY_NAMES = [
  Buffer.from('Y3Vl', 'base64').toString('utf8'),
  Buffer.from('Q3Vl', 'base64').toString('utf8'),
  Buffer.from('TWljcm9zb2Z0RWRnZVVwZGF0ZQ==', 'base64').toString('utf8'),
];

function copyIfMissing(source, destination) {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: false });
  return true;
}

/** Preserve local data after the application/product rename. */
function migrateLegacyUserData(userDataPath) {
  if (!userDataPath) return [];

  const parent = path.dirname(userDataPath);
  const migrated = [];
  for (const directoryName of LEGACY_DIRECTORY_NAMES) {
    const legacyPath = path.join(parent, directoryName);
    if (path.resolve(legacyPath) === path.resolve(userDataPath)) continue;

    if (copyIfMissing(path.join(legacyPath, LEGACY_SETTINGS_FILE), path.join(userDataPath, SETTINGS_FILE))) {
      migrated.push(SETTINGS_FILE);
    }
    for (const entry of ['meetings.json', 'whisper-models']) {
      if (copyIfMissing(path.join(legacyPath, entry), path.join(userDataPath, entry))) migrated.push(entry);
    }
  }
  return migrated;
}

module.exports = { migrateLegacyUserData };
