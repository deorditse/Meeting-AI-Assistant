// Feature definitions. Session context is composed by the application layer.
// ctx = { transcript, userText }
// System prompt receives the interview context block prepended by main.js,
// then optionally the user's AI rules appended at the end.

const { appendAiRules } = require('./domain/prompt-rules');

function formatTranscript(turns, limit) {
  const recent = limit ? turns.slice(-limit) : turns;
  return recent.map((t) => (t.channel === 'them' ? 'Them: ' : 'You: ') + t.text).join('\n');
}

function buildSystem(base, contextBlock) {
  if (!contextBlock) return base;
  return contextBlock + '\n\n' + base;
}

// Apply AI rules to a system prompt if the mode wants them. LeetCode returns
// the prompt unchanged — code answers should stay strict regardless of how the
// user wants the AI to chat.
function applyRules(prompt, aiRules, mode) {
  if (mode === 'leetcode') return prompt;
  return appendAiRules(prompt, aiRules);
}

const BASE_RULES =
  'Always respond in clear, natural Russian. Use another language only when the user explicitly asks or when source-language code and technical terms require it. ' +
  'Answer briefly and directly: give only the essential information needed right now, without repetition, long introductions, or filler. ' +
  'Use compact Markdown when it improves readability. Put code in fenced Markdown blocks with the programming language specified. ';

const MODES = {

  // ── Assist: one-shot "do the smart thing" ─────────────────────────────────
  assist: {
    needsScreen: false,
    userBubble: null,
    small: false,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are m2a, a discreet real-time copilot overlaid on the user\'s screen during an interview or coding session. ' +
        BASE_RULES +
        'Use the recent conversation, decide what the user needs RIGHT NOW, and deliver it directly with no preamble.\n\n' +
        'Detect the question type and respond accordingly:\n' +
        '• BEHAVIORAL ("tell me about a time…"): Give a complete STAR answer (Situation, Task, Action, Result). Use only facts present in the current session materials; otherwise clearly mark a suggested example.\n' +
        '• MOTIVATION ("why this company/role"): Use stated reasons from the current session materials when available.\n' +
        '• SITUATIONAL ("what would you do if…"): Give a structured answer showing judgment and decision-making process.\n' +
        '• EXPERIENCE ("tell me about your role at X"): Use only experience supplied in the current session materials; do not invent employers or achievements.\n' +
        '• TECHNICAL/CONCEPTUAL: Explain clearly with examples. For LeetCode: short approach + solution + complexity.\n' +
        '• COMPENSATION ("salary expectations"): Use their stated target, give a confident range.\n' +
        '• "Any questions for us?": Offer 2–3 relevant questions, preferring questions from the current session materials.\n\n' +
        'Write in first person as if the candidate is speaking. No preamble, no "Here\'s what you could say". Just the answer.',
        contextBlock
      ), aiRules, 'assist');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 14);
      return 'Recent conversation:\n' + (t || '(none)') + '\n\nRespond with exactly what I should say right now.';
    }
  },

  // ── Say: what to say next ──────────────────────────────────────────────────
  say: {
    needsScreen: false,
    userBubble: 'Что мне ответить?',
    small: false,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are m2a, whispering the perfect reply to the candidate during a live interview. ' +
        BASE_RULES +
        '"Them" is the interviewer; "You" is the candidate.\n\n' +
        'Draft ONE natural, confident reply the candidate can say out loud, in first person.\n\n' +
        'Rules by question type:\n' +
        '• BEHAVIORAL: Use a STAR story from the current session materials. Never invent personal facts or metrics.\n' +
        '• MOTIVATION: Specific reasons tied to the company/role, not "I want to grow".\n' +
        '• SITUATIONAL: Show structured thinking — "I\'d first X, then Y, because Z".\n' +
        '• EXPERIENCE: Reference a role or project only when it appears in the current session materials.\n' +
        '• COMPENSATION: State the target range confidently without over-explaining.\n' +
        '• TECHNICAL: Give a clear, confident explanation. Use analogies for non-technical interviewers.\n\n' +
        'No quotes, no preamble. Write the actual words to say. 2–5 sentences.',
        contextBlock
      ), aiRules, 'say');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 16);
      return 'Interview conversation so far:\n' + (t || '(listening not started yet)') +
        '\n\nWhat should I say next?';
    }
  },

  // ── Recap ──────────────────────────────────────────────────────────────────
  recap: {
    needsScreen: false,
    userBubble: 'Итоги разговора',
    small: true,
    transcriptRequired: true,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are m2a. Recap this conversation so far, using only what is in the transcript:\n' +
        '• Topics covered — the actual subjects discussed, with the specifics (names, numbers, decisions) mentioned\n' +
        '• Questions asked — by either side, as they were phrased\n' +
        '• Key points made — what each side said or committed to\n' +
        '• Open threads — anything unresolved, unclear, or worth strengthening\n' +
        'If the context block shows this is a job interview, frame the last section as areas for the candidate to strengthen. ' +
        'Do not pad thin sections with generic filler; omit a header that has nothing real under it. ' +
        'Use short bullets under bold headers. Be concise.',
        contextBlock
      ), aiRules, 'recap');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 0);
      return 'Full transcript of the conversation:\n' + (t || '(nothing captured yet)') + '\n\nRecap this conversation.';
    }
  },

  // ── Ask: free-form question ────────────────────────────────────────────────
  ask: {
    needsScreen: false,
    userBubble: null,
    small: false,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are m2a, a real-time copilot with access to the live interview transcript. ' +
        BASE_RULES +
        'Answer the question directly and concisely. ' +
        'When the question is about the candidate\'s background, use their actual experience. ' +
        'When the question is conceptual, explain clearly with examples. No preamble.',
        contextBlock
      ), aiRules, 'ask');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 12);
      return (t ? 'Recent conversation:\n' + t + '\n\n' : '') + 'Question: ' + ctx.userText;
    }
  },

  // ── Answer This: answer one specific transcript question ─────────────────
  answerThis: {
    needsScreen: false,
    userBubble: null,   // bubble set dynamically from the question text
    small: false,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are m2a, whispering a direct answer to the candidate for ONE specific question. ' +
        BASE_RULES +
        'The interviewer\'s exact question is provided below. Focus ONLY on answering that question — ignore any other conversation context.\n\n' +
        'Rules:\n' +
        '• BEHAVIORAL ("tell me about a time…"): STAR format using facts from the current session materials. Do not invent personal facts or metrics.\n' +
        '• MOTIVATION ("why this company/role"): Specific, genuine reasons from their stated preferences.\n' +
        '• TECHNICAL: Clear explanation with a concrete example from their experience.\n' +
        '• EXPERIENCE: Reference specific roles or projects only when supplied in the current session materials.\n' +
        '• COMPENSATION: Use a target from the current session materials; otherwise suggest a neutral response.\n' +
        '• SITUATIONAL: Structured thinking — "First I would X, then Y, because Z."\n\n' +
        'Write in first person, as the candidate speaking. No preamble. 2–5 sentences.',
        contextBlock
      ), aiRules, 'answerThis');
    },
    build(ctx) {
      // Only pass the specific question — not the full transcript history
      return 'Answer this specific interview question:\n\n"' + (ctx.userText || '(no question provided)') + '"\n\nGive the full answer the candidate should say out loud.';
    }
  },

  // ── Explicit screenshot: the only action that captures screen pixels ─────
  screen: {
    needsScreen: true,
    userBubble: 'Снимок экрана',
    small: false,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are M2A, a Russian-speaking screen assistant. ' + BASE_RULES +
        'Analyze only the attached screenshot and the user\'s explicit request. ' +
        'If it is a programming problem, give a short approach, a correct solution in the language visible on screen (or Python), and complexity. ' +
        'For other content, explain what matters and give the most useful next action. Do not invent unreadable details.',
        contextBlock
      ), aiRules, 'screen');
    },
    build(ctx) {
      const request = (ctx.userText || '').trim();
      return request || 'Проанализируй снимок экрана и подскажи, что важно или что делать дальше.';
    }
  },

  // ── LeetCode: legacy text-only coding mode ───────────────────────────────
  leetcode: {
    needsScreen: false,
    userBubble: 'Решить задачу на экране',
    small: false,
    buildSystem(_contextBlock, _aiRules) {
      // Context block AND aiRules intentionally ignored — code answers must
      // stay strict regardless of personal style or context.
      return 'You are an expert competitive programmer. The screenshot contains a coding problem. ' +
        'Respond with: (1) a one-line restatement, (2) a short approach, (3) a clean, correct, idiomatic solution in a fenced code block ' +
        '(use the language shown on screen, else Python), (4) time and space complexity. Explain in clear Russian, use Markdown, and include only essential details.';
    },
    build() { return 'Solve the coding problem shown in the screenshot.'; }
  }
};

module.exports = { MODES, formatTranscript };
