const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('action tabs remain on one horizontally scrollable row', () => {
  const root = path.join(__dirname, '..');
  const styles = fs.readFileSync(path.join(root, 'frontend/src/app/styles/global.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');

  assert.match(styles, /#action-row[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(styles, /#action-row[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.act[\s\S]*?flex:\s*0 0 auto/);
  assert.match(renderer, /actionRow\.scrollLeft \+= event\.deltaY/);
  assert.match(renderer, /passive:\s*false/);
});
