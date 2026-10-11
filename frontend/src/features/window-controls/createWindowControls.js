const INTERACTIVE_SELECTOR = '.window-resize-handle, #toolbar, #panel-wrap, #transcript-sidebar, #settings-scrim, #context-scrim, #meetings-scrim, #onboard-scrim, #consent-scrim';

export function createWindowControls({ m2a, documentRef = document, windowRef = window }) {
  let ignoring = null;
  let dragging = false;
  let resizing = false;
  let resizePointerId = null;
  const setIgnore = (value) => {
    if (value === ignoring) return;
    ignoring = value;
    m2a.setIgnoreMouse(value);
  };

  documentRef.addEventListener('mousemove', (event) => {
    if (dragging || resizing) return;
    const element = documentRef.elementFromPoint(event.clientX, event.clientY);
    setIgnore(!element?.closest?.(INTERACTIVE_SELECTOR));
  });
  setIgnore(true);

  const toolbar = documentRef.querySelector('#toolbar');
  toolbar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button, input, .tb-opacity-wrap')) return;
    event.preventDefault();
    toolbar.setPointerCapture(event.pointerId);
    dragging = true;
    setIgnore(false);
    toolbar.classList.add('dragging');
    m2a.windowDragStart();
  });
  toolbar.addEventListener('lostpointercapture', () => {
    if (!dragging) return;
    dragging = false;
    toolbar.classList.remove('dragging');
    m2a.windowDragEnd();
  });

  documentRef.querySelectorAll('.window-resize-handle').forEach((handle) => {
    const finishResize = (event) => {
      if (!resizing) return;
      if (event?.pointerId != null && resizePointerId != null && event.pointerId !== resizePointerId) return;
      resizing = false;
      resizePointerId = null;
      m2a.windowResizeEnd();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      resizing = true;
      resizePointerId = event.pointerId;
      setIgnore(false);
      m2a.windowResizeStart(handle.dataset.resizeEdge);
    });
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
    handle.addEventListener('lostpointercapture', finishResize);
  });

  windowRef.addEventListener('blur', () => {
    if (!resizing) return;
    resizing = false;
    resizePointerId = null;
    m2a.windowResizeEnd();
  });

  windowRef.addEventListener('scroll', () => {
    if (windowRef.scrollY || windowRef.scrollX) windowRef.scrollTo(0, 0);
  }, { passive: true });
}
