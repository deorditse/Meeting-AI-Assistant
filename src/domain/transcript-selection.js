function selectTranscript(turns, excludedIds = []) {
  const excluded = new Set((Array.isArray(excludedIds) ? excludedIds : []).map(String));
  return (Array.isArray(turns) ? turns : []).filter((turn) => {
    if (!turn || turn.id == null) return true;
    return !excluded.has(String(turn.id));
  });
}

module.exports = { selectTranscript };
