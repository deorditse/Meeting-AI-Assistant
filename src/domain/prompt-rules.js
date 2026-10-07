const MAX_AI_RULES_CHARS = 2000;

function appendAiRules(systemPrompt, aiRules) {
  const rules = typeof aiRules === 'string' ? aiRules.trim() : '';
  if (!rules) return systemPrompt;
  return systemPrompt +
    '\n\nThe user has set the following rules for how you write. Follow them strictly. ' +
    'If two rules conflict, prefer the more specific rule.\n' +
    '--- USER RULES ---\n' + rules.slice(0, MAX_AI_RULES_CHARS) + '\n--- END USER RULES ---';
}

module.exports = { MAX_AI_RULES_CHARS, appendAiRules };
