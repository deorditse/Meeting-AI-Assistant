// Give the development Electron executable the M2A name on Windows.
// Packaged builds get their name and metadata from electron-builder.cjs.

const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') process.exit(0);

const displayName = 'M2A.exe';
const distDirectory = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const pathFile = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
const source = path.join(distDirectory, 'electron.exe');
const destination = path.join(distDirectory, displayName);

if (!fs.existsSync(destination)) {
  if (!fs.existsSync(source)) {
    console.warn('[postinstall] No Electron executable found; skipping the Windows rename.');
    process.exit(0);
  }
  fs.renameSync(source, destination);
  console.log(`[postinstall] Renamed electron.exe to ${displayName}`);
}

fs.writeFileSync(pathFile, displayName);
