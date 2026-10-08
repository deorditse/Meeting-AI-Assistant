const test = require('node:test');
const assert = require('node:assert/strict');
const { RESIZE_EDGES, calculateResizeBounds } = require('../src/domain/window-geometry');

const start = { x: 100, y: 200, width: 800, height: 600 };

test('supports all four edges and corners', () => {
  assert.deepEqual(RESIZE_EDGES, ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']);
  assert.deepEqual(calculateResizeBounds(start, 50, 30, 'se', 500, 400), { x: 100, y: 200, width: 850, height: 630 });
  assert.deepEqual(calculateResizeBounds(start, 50, 30, 'nw', 500, 400), { x: 150, y: 230, width: 750, height: 570 });
});

test('keeps the opposite edge anchored when minimum size is reached', () => {
  assert.deepEqual(calculateResizeBounds(start, 700, 500, 'nw', 500, 400), { x: 400, y: 400, width: 500, height: 400 });
  assert.deepEqual(calculateResizeBounds(start, -700, -500, 'se', 500, 400), { x: 100, y: 200, width: 500, height: 400 });
});
