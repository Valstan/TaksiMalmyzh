#!/usr/bin/env node
// SessionStart hook (pool #081): именует сессию "<Проект> <день> <месяц>" (ru-RU, без года).
// Канон: ../brain_matrica/cross-project-ideas/ideas/081-session-start-naming-hook.md
const PROJECT = "Такси";
const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', sessionTitle: PROJECT + ' ' + date },
}));
