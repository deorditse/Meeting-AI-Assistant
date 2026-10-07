const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(target) : (entry.name.endsWith('.js') ? [target] : []);
  });
}

test('domain and application layers stay independent from Electron infrastructure', () => {
  for (const layer of ['domain', 'application']) {
    for (const file of javascriptFiles(path.join(root, 'src', layer))) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /require\(['"]electron['"]\)/, `${file} imports Electron`);
      assert.doesNotMatch(source, /infrastructure\/electron/, `${file} imports an outer layer`);
    }
  }
});

test('renderer uses the preload bridge instead of importing Electron directly', () => {
  for (const file of javascriptFiles(path.join(root, 'frontend', 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from ['"]electron['"]|require\(['"]electron['"]\)/, `${file} bypasses preload`);
  }
});

test('legacy global interview context modules stay removed', () => {
  for (const file of ['context.js', 'interview-context.js', 'profile-context.js', 'resume-context.js', 'notes.js']) {
    assert.equal(fs.existsSync(path.join(root, 'src', file)), false, `${file} was reintroduced`);
  }
});
