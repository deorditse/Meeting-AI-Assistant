const { RESIZE_EDGES, calculateResizeBounds } = require('../../domain/window-geometry');

function createWindowControls({ ipcMain, screen, store, getWindow, sideWidth, minimumMainWidth, minimumHeight }) {
  const minimumWidth = sideWidth * 2 + minimumMainWidth;
  const resizeEdges = new Set(RESIZE_EDGES);
  let dragTimer = null;
  let resizeState = null;

  function currentWindow() {
    const window = getWindow();
    return window && !window.isDestroyed() ? window : null;
  }

  function saveGeometry() {
    const window = currentWindow();
    if (!window) return;
    const { x, y, width, height } = window.getBounds();
    store.setSettings({
      windowX: x + sideWidth,
      windowY: y,
      windowWidth: Math.max(minimumMainWidth, width - sideWidth * 2),
      windowHeight: Math.max(minimumHeight, height)
    });
  }

  function stopDrag() {
    clearInterval(dragTimer);
    dragTimer = null;
  }

  function stopResize() {
    resizeState = null;
  }

  function startDrag() {
    const window = currentWindow();
    if (!window) return;
    stopResize();
    stopDrag();
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const offsetX = cursor.x - bounds.x;
    const offsetY = cursor.y - bounds.y;
    dragTimer = setInterval(() => {
      const activeWindow = currentWindow();
      if (!activeWindow) { stopDrag(); return; }
      const point = screen.getCursorScreenPoint();
      activeWindow.setBounds({ x: point.x - offsetX, y: point.y - offsetY, width: bounds.width, height: bounds.height });
    }, 16);
  }

  function validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: Number(point.x), y: Number(point.y) }
      : null;
  }

  function startResize(edge, rendererPoint) {
    const window = currentWindow();
    if (!window || !resizeEdges.has(edge)) return;
    stopDrag();
    stopResize();
    resizeState = {
      edge,
      startCursor: validPoint(rendererPoint) || screen.getCursorScreenPoint(),
      startBounds: window.getBounds()
    };
  }

  function moveResize(rendererPoint) {
    const window = currentWindow();
    const point = validPoint(rendererPoint);
    if (!window || !resizeState || !point) return;
    const { edge, startCursor, startBounds } = resizeState;
    window.setBounds(calculateResizeBounds(
      startBounds,
      point.x - startCursor.x,
      point.y - startCursor.y,
      edge,
      minimumWidth,
      minimumHeight
    ));
  }

  ipcMain.on('window:drag-start', startDrag);
  ipcMain.on('window:drag-end', () => {
    if (!dragTimer) return;
    stopDrag();
    saveGeometry();
  });
  ipcMain.on('window:resize-start', (_event, edge, point) => startResize(edge, point));
  ipcMain.on('window:resize-move', (_event, point) => moveResize(point));
  ipcMain.on('window:resize-end', () => {
    if (!resizeState) return;
    stopResize();
    saveGeometry();
  });

  return Object.freeze({
    saveGeometry,
    attachPersistence(window, debounceMs = 500) {
      let timer = null;
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(saveGeometry, debounceMs);
      };
      window.on('moved', schedule);
      window.on('resize', schedule);
      window.once('closed', () => clearTimeout(timer));
    },
    dispose() {
      stopDrag();
      stopResize();
    }
  });
}

module.exports = { createWindowControls };
