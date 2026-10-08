function cloneMeeting(meeting) {
  return meeting ? JSON.parse(JSON.stringify(meeting)) : null;
}

function createMeetingHistoryService({ getStore, getCurrentMeeting = () => null, isCapturing = () => false, endCurrentMeeting = () => {}, resumeMeeting = () => null }) {
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
    const currentId = getCurrentMeeting()?.id || null;
    return newestFirst(meetings).map((meeting) => ({
      ...cloneMeeting(meeting),
      active: meeting.id === activeId,
      current: meeting.id === currentId
    }));
  }

  function get(id) {
    const meeting = store().get(String(id || ''));
    if (!meeting) return null;
    const current = meeting.id === (getCurrentMeeting()?.id || null);
    return { ...cloneMeeting(meeting), active: isCapturing() && current, current };
  }

  function resume(id) {
    const meetingId = String(id || '');
    const meeting = store().get(meetingId);
    if (!meeting) return { ok: false, code: 'NOT_FOUND', message: 'Сессия не найдена.' };
    const currentId = getCurrentMeeting()?.id || null;
    if (isCapturing() && currentId && currentId !== meetingId) {
      return { ok: false, code: 'CAPTURING', message: 'Сначала завершите запись текущей сессии.' };
    }
    const resumed = resumeMeeting(meetingId);
    return resumed
      ? { ok: true, meeting: cloneMeeting(resumed) }
      : { ok: false, code: 'RESUME_FAILED', message: 'Не удалось продолжить сессию.' };
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

  return Object.freeze({ list, get, resume, remove });
}

module.exports = { createMeetingHistoryService, cloneMeeting };
