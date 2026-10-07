function buildNotesPrompt(transcript) {
  const lines = transcript.map((turn) => `${turn.channel === 'them' ? 'Them' : 'You'}: ${turn.text}`).join('\n');
  return 'Meeting transcript:\n' + (lines || '(empty)') +
    '\n\nWrite concise meeting notes with EXACTLY these five headings, each heading alone on its own line:\n' +
    'Meeting Summary:\nKey Points:\nDecisions:\nAction Items:\nFollow-Up:\n' +
    'Use a hyphen at the start of each bullet. Keep Summary to 2–3 sentences.';
}

const HEADERS = [
  ['summary', /^meeting summary\s*:?\s*$/i],
  ['keyPoints', /^key points\s*:?\s*$/i],
  ['decisions', /^decisions\s*:?\s*$/i],
  ['actionItems', /^action items\s*:?\s*$/i],
  ['followUp', /^follow[- ]up\s*:?\s*$/i]
];

function parseNotes(text) {
  const result = { summary: '', keyPoints: [], decisions: [], actionItems: [], followUp: [] };
  if (!text || !text.trim()) return result;
  const buckets = { summary: [], keyPoints: [], decisions: [], actionItems: [], followUp: [] };
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = HEADERS.find(([, pattern]) => pattern.test(line));
    if (header) { current = header[0]; continue; }
    if (!current) continue;
    if (!line) { current = null; continue; }
    buckets[current].push(line);
  }
  for (const [key, values] of Object.entries(buckets)) {
    if (key === 'summary') result.summary = values.join(' ').trim();
    else result[key] = values.map((line) => line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\[[ x]\]\s*/, '')
      .replace(/^[0-9]+[.)]\s*/, '')
      .trim()).filter(Boolean);
  }
  if (!Object.values(buckets).some((values) => values.length)) result.summary = text.trim();
  return result;
}

module.exports = { buildNotesPrompt, parseNotes };
