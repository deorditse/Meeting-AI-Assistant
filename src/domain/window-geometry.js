const RESIZE_EDGES = Object.freeze(['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']);
const RESIZE_EDGE_SET = new Set(RESIZE_EDGES);

function calculateResizeBounds(start, deltaX, deltaY, edge, minimumWidth, minimumHeight) {
  if (!RESIZE_EDGE_SET.has(edge)) return { ...start };

  let { x, y, width, height } = start;
  if (edge.includes('e')) width = Math.max(minimumWidth, start.width + deltaX);
  if (edge.includes('s')) height = Math.max(minimumHeight, start.height + deltaY);
  if (edge.includes('w')) {
    width = Math.max(minimumWidth, start.width - deltaX);
    x = start.x + start.width - width;
  }
  if (edge.includes('n')) {
    height = Math.max(minimumHeight, start.height - deltaY);
    y = start.y + start.height - height;
  }
  return { x, y, width, height };
}

module.exports = { RESIZE_EDGES, calculateResizeBounds };
