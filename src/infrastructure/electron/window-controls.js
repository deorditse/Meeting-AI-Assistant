const { RESIZE_EDGES, calculateResizeBounds } = require('../../domain/window-geometry');

function createWindowControls({ ipcMain, screen, store, getWindow, sideWidth, minimumMainWidth, minimumHeight }) {
  const minimumWidth = sideWidth * 2 + minimumMainWidth;
  const resizeEdges = new Set(RESIZE_EDGES);
  let dragTimer = null;
  let resizeTimer = null;

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
    clearInterval(resizeTimer);
    resizeTimer = null;
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

  function startResize(edge) {
    const window = currentWindow();
    if (!window || !resizeEdges.has(edge)) return;
    stopDrag();
    stopResize();
    const startCursor = screen.getCursorScreenPoint();
    const startBounds = window.getBounds();
    resizeTimer = setInterval(() => {
      const activeWindow = currentWindow();
      if (!activeWindow) { stopResize(); return; }
      const cursor = screen.getCursorScreenPoint();
      activeWindow.setBounds(calculateResizeBounds(
        startBounds,
        cursor.x - startCursor.x,
        cursor.y - startCursor.y,
        edge,
        minimumWidth,
        minimumHeight
      ));
    }, 16);
  }

  ipcMain.on('window:drag-start', startDrag);
  ipcMain.on('window:drag-end', () => {
    if (!dragTimer) return;
    stopDrag();
    saveGeometry();
  });
  ipcMain.on('window:resize-start', (_event, edge) => startResize(edge));
  ipcMain.on('window:resize-end', () => {
    if (!resizeTimer) return;
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
