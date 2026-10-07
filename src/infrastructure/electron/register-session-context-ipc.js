const path = require('path');
const { MAX_CONTEXT_ITEM_CHARS, extractPageText } = require('../../session-context');

function registerSessionContextIpc({ ipcMain, dialog, getWindow, service, parseDocumentFile, fetchImpl = fetch }) {
  ipcMain.handle('session-context:pick-files', async () => {
    try {
      const result = await dialog.showOpenDialog(getWindow(), {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Материалы', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm'] }]
      });
      if (result.canceled || !result.filePaths.length) return { canceled: true, files: [] };
      const files = [];
      for (const filePath of result.filePaths.slice(0, 12)) {
        const text = (await parseDocumentFile(filePath)).slice(0, MAX_CONTEXT_ITEM_CHARS);
        if (text) files.push({ name: path.basename(filePath), text });
      }
      return { canceled: false, files };
    } catch (error) {
      return { canceled: false, files: [], error: error?.message || String(error) };
    }
  });

  ipcMain.handle('session-context:fetch-url', async (_event, rawUrl) => {
    try {
      const url = new URL(String(rawUrl || '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Поддерживаются только ссылки http:// и https://.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetchImpl(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'M2A/0.2 session-context-reader' }
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`Ссылка вернула HTTP ${response.status}.`);
      const contentType = response.headers.get('content-type') || '';
      if (!/(text|json|xml|html|markdown)/i.test(contentType)) throw new Error('По ссылке нет читаемого текстового материала.');
      const raw = (await response.text()).slice(0, 1000000);
      const extracted = /html/i.test(contentType) || /<html[\s>]/i.test(raw)
        ? extractPageText(raw)
        : { title: '', text: raw.trim().slice(0, MAX_CONTEXT_ITEM_CHARS) };
      if (!extracted.text) throw new Error('На странице не найден текст.');
      return { url: response.url || url.toString(), name: extracted.title || url.hostname, text: extracted.text };
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Не удалось загрузить ссылку за 15 секунд.'
        : (error?.message || String(error));
      return { error: message };
    }
  });

  ipcMain.handle('session-context:get', () => service.get());
  ipcMain.handle('session-context:set', (_event, value) => service.set(value));
  ipcMain.handle('session-context:clear', () => service.clear());
}

module.exports = { registerSessionContextIpc };
