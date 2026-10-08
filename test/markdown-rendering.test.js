const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('chat renderer supports structured Markdown and language-labelled code blocks', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/app/styles/global.css'), 'utf8');

  assert.match(renderer, /class="code-block"/);
  assert.match(renderer, /class="code-language"/);
  assert.match(renderer, /language-\$\{esc\(codeLanguage\)\}/);
  assert.match(renderer, /<h\$\{level\}>/);
  assert.match(renderer, /const numbered =/);
  assert.match(renderer, /<blockquote>/);
  assert.match(styles, /\.ai-text \.code-language/);
  assert.match(styles, /\.ai-text ul, \.ai-text ol/);
});
