const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { androidSdkCMakeCandidates, compareVersionsDescending } = require('../src/infrastructure/local-toolchain');

test('Android SDK CMake candidates prefer the newest installed version', (context) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-toolchain-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'Library', 'Android', 'sdk', 'cmake');
  fs.mkdirSync(path.join(root, '3.22.1'), { recursive: true });
  fs.mkdirSync(path.join(root, '3.31.0'), { recursive: true });
  assert.deepEqual(androidSdkCMakeCandidates(home), [
    path.join(root, '3.31.0', 'bin', 'cmake'),
    path.join(root, '3.22.1', 'bin', 'cmake')
  ]);
});

test('version comparison is numeric rather than lexical', () => {
  assert.deepEqual(['3.9', '3.22', '4.0'].sort(compareVersionsDescending), ['4.0', '3.22', '3.9']);
});
