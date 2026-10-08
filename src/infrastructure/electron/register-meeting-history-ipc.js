function registerMeetingHistoryIpc({ ipcMain, service }) {
  ipcMain.handle('meetings:list', (_event, query) => service.list(query));
  ipcMain.handle('meetings:get', (_event, id) => service.get(id));
  ipcMain.handle('meetings:resume', (_event, id) => service.resume(id));
  ipcMain.handle('meetings:remove', (_event, id) => service.remove(id));
}

module.exports = { registerMeetingHistoryIpc };
