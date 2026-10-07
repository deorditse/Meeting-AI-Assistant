const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
// electron-builder's Arch enum, inlined rather than imported: `builder-util` is a
// transitive dependency of electron-builder, not a declared one, so requiring it made
// this script (and its test) fail wherever electron-builder is not installed.
const Arch = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal',
               ia32: 0, x64: 1, armv7l: 2, arm64: 3, universal: 4 };
const { prepareWhisperRuntime } = require('./prepare-whisper-runtime');
const { getRuntimeTarget } = require('../src/whisper-runtime-manifest');

function findStableLocalMacIdentity() {
  if (process.env.M2A_LOCAL_SIGN_IDENTITY) return process.env.M2A_LOCAL_SIGN_IDENTITY;
  try {
    const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const match = identities.match(/^\s*\d+\)\s+[0-9A-F]+\s+"(Apple Development:[^"]+)"/m);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/** Add the matching native runtime after Electron has assembled each target.
 *
 * On by default for Windows and Linux: those targets fetch a checksum-verified
 * upstream release archive over the network only, no local toolchain, so
 * every packaged Windows/Linux build ships local transcription, matching what
 * the README promises ("Packaged builds include a pinned whisper.cpp
 * runtime"). macOS instead builds whisper.cpp from source with cmake, which
 * needs Xcode command-line tools and a slower, toolchain-dependent build —
 * and its pinned source-archive checksum is the fragile one (see the note in
 * whisper-runtime-manifest.js) — so macOS stays opt-in via M2A_BUNDLE_WHISPER=1
 * to keep `npm run dist:mac`/`dist` and the signed macOS release from
 * suddenly requiring a local C++ toolchain. Set M2A_BUNDLE_WHISPER=0 to skip
 * bundling on Windows/Linux too (a faster pack for local iteration).
 */
module.exports = async function afterPack(context) {
  const platform = context.packager.platform.nodeName;
  const architecture = typeof context.arch === 'number' ? Arch[context.arch] : context.arch;
  if (!platform || !architecture) throw new Error('electron-builder did not provide a runtime target.');

  const target = getRuntimeTarget(platform, architecture);
  const explicitChoice = process.env.M2A_BUNDLE_WHISPER;
  const bundleWhisper = explicitChoice ? explicitChoice !== '0' : target.kind === 'archive';
  if (!bundleWhisper) {
    console.log('[m2a] Skipping the bundled whisper runtime (set M2A_BUNDLE_WHISPER=1 to include it on this platform).');
  } else {
    const outputDirectory = path.join(context.appOutDir, 'resources', 'whisper-runtime');
    await prepareWhisperRuntime({ platform, architecture, outputDirectory });
  }

  // identity:null keeps local builds independent of a paid Developer ID, but
  // electron-builder then leaves Electron's linker signature intact. Prefer an
  // existing Apple Development identity for local packs: its designated code
  // requirement stays stable across rebuilds, so macOS TCC does not mistake
  // each build for a new application and discard its Screen Recording grant.
  // Machines without one retain the ad-hoc fallback.
  if (platform === 'darwin' && process.env.MAC_SIGN !== '1') {
    const productFilename = context.packager.appInfo && context.packager.appInfo.productFilename;
    if (productFilename) {
      const appPath = path.join(context.appOutDir, `${productFilename}.app`);
      const entitlements = path.join(__dirname, '..', 'build-resources', 'entitlements.mac.plist');
      if (fs.existsSync(appPath)) {
        const identity = findStableLocalMacIdentity() || '-';
        execFileSync('/usr/bin/codesign', [
          '--force', '--deep', '--sign', identity, '--entitlements', entitlements, appPath
        ], { stdio: 'inherit' });
        console.log(`[m2a] ${identity === '-' ? 'Ad-hoc' : 'Apple Development'} signed local macOS bundle: ${appPath}`);
      }
    }
  }
};

module.exports.findStableLocalMacIdentity = findStableLocalMacIdentity;
