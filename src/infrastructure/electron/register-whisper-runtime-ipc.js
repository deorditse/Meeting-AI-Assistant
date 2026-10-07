function registerWhisperRuntimeIpc({ ipcMain, service, onPrepared = () => {} }) {
  ipcMain.handle('whisper:runtime-prepare', async () => {
    const result = await service.prepare();
    if (result.ok) onPrepared(result.runtime);
    return result;
  });
}

module.exports = { registerWhisperRuntimeIpc };
