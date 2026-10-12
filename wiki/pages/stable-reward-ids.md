---
title: Стабильные ID наград и расчёт уровня
type: concept
sources: [docs/plans/2026-10-06-daily-program.md, lessons/0005-daily-program.html, docs/plans/2026-10-12-puzzle-progress-design.md, docs/manual-qa.md]
updated: 2026-10-12
---

Награда за выполненное задание дня — 20 XP, сверх нормы наград нет. Её ID строится как `startedOn:date:taskId` (начало программы + день + вид задания), например `2026-10-06:2026-10-06:puzzles`. Число открытий popup, импортов и обновлений в ID не входит, поэтому повторное чтение даёт тот же ID и не удваивает награду (идемпотентность). В уроке награды собираются в `Map` внутри `reconcilePractice` (`practice-engine.js`).

- Ручные награды задач и разборов пересчитываются: отмена отметки или удаление заметки снимает XP, повторное выполнение возвращает одну награду.
- Награды за игры сохраняются как полученные достижения, в том числе при восстановлении копии без истории партий.
- Правка заметки не создаёт нового задания и сохраняет первоначальный день разбора.
- Уровень вычисляется, а не хранится: `1 + floor(XP / 100)`, в уроке также `nextLevelXp = 100 - totalXp % 100`; поэтому в резервную копию не входит.
- 0.4.1: автоотметка задач (`source: 'auto'`) получает ту же награду 20 XP с тем же ID `startedOn:date:puzzles` через существующий `reconcilePractice`; ручная и автоматическая отметка дня дают один ID, повторные обновления счётчика награду не удваивают, сверх нормы XP не растёт. Ручная отмена снимает награду (−20 XP по маршруту `docs/manual-qa.md`) и ставит `autoSuppressed`, поэтому автоотметка её не вернёт ([[day-auto-mark-and-suppression]]).

Связи: [[plan-stage4-daily-program]], [[lesson-05-daily-program-xp]], [[practice-transaction]], [[backup-format-v2]], [[plan-0-4-1-puzzle-auto-count]].

Источники: `docs/plans/2026-10-06-daily-program.md`, `lessons/0005-daily-program.html`, `docs/plans/2026-10-12-puzzle-progress-design.md`, `docs/manual-qa.md`.
