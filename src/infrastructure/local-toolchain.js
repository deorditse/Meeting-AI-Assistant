const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function executableWorks(executable, args = ['--version']) {
  try {
    execFileSync(executable, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function versionParts(value) {
  return String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersionsDescending(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

function androidSdkCMakeCandidates(homeDirectory = os.homedir()) {
  const root = path.join(homeDirectory, 'Library', 'Android', 'sdk', 'cmake');
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionsDescending)
      .map((version) => path.join(root, version, 'bin', 'cmake'));
  } catch {
    return [];
  }
}

function resolveCMakeExecutable(environment = process.env, homeDirectory = os.homedir()) {
  const explicit = environment.M2A_CMAKE_PATH || environment.CMAKE_PATH;
  const candidates = [
    explicit,
    'cmake',
    '/opt/homebrew/bin/cmake',
    '/usr/local/bin/cmake',
    '/Applications/CMake.app/Contents/bin/cmake',
    ...androidSdkCMakeCandidates(homeDirectory)
  ].filter(Boolean);
  return candidates.find((candidate) => executableWorks(candidate)) || '';
}

module.exports = { resolveCMakeExecutable, androidSdkCMakeCandidates, compareVersionsDescending };
