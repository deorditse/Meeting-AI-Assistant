const assert = require('node:assert/strict');
const test = require('node:test');

const builder = require('../electron-builder.cjs');
const pkg = require('../package.json');

test('defines an explicit Windows x64 package target', () => {
  assert.match(pkg.scripts['pack:win'], /npm run build:renderer && electron-builder --win --dir$/);
  assert.match(pkg.scripts['dist:win'], /npm run build:renderer && electron-builder --win$/);
  assert.deepEqual(builder.win.target, [{ target: 'nsis', arch: ['x64'] }]);
});

test('ships every runtime directory in packaged builds', () => {
  assert.ok(builder.files.includes('main.js'));
  assert.ok(builder.files.includes('preload.js'));
  assert.ok(builder.files.includes('src/**/*'));
  assert.ok(builder.files.includes('renderer-dist/**/*'));
});
