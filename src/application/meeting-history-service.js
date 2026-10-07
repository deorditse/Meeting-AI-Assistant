function cloneMeeting(meeting) {
  return meeting ? JSON.parse(JSON.stringify(meeting)) : null;
}

function createMeetingHistoryService({ getStore, getCurrentMeeting = () => null, isCapturing = () => false, endCurrentMeeting = () => {} }) {
  function store() {
    const value = getStore();
    if (!value) throw new Error('История сессий ещё не готова.');
    return value;
  }

  function newestFirst(items) {
    return items.slice().sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0));
  }

  function list(query = '') {
    const value = String(query || '').trim();
    const meetings = value ? store().search(value) : store().list();
    const activeId = isCapturing() ? (getCurrentMeeting()?.id || null) : null;
    return newestFirst(meetings).map((meeting) => ({ ...cloneMeeting(meeting), active: meeting.id === activeId }));
  }

  function get(id) {
    const meeting = store().get(String(id || ''));
    if (!meeting) return null;
    return { ...cloneMeeting(meeting), active: isCapturing() && meeting.id === (getCurrentMeeting()?.id || null) };
  }

  function remove(id) {
    const meetingId = String(id || '');
    if (meetingId && meetingId === (getCurrentMeeting()?.id || null)) {
      if (isCapturing()) return { ok: false, code: 'ACTIVE_MEETING', message: 'Сначала завершите текущую сессию.' };
      endCurrentMeeting();
    }
    return store().remove(meetingId)
      ? { ok: true }
      : { ok: false, code: 'NOT_FOUND', message: 'Сессия уже удалена или не найдена.' };
  }

  return Object.freeze({ list, get, remove });
}

module.exports = { createMeetingHistoryService, cloneMeeting };
