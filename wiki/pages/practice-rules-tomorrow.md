---
title: Изменения норм действуют с завтра
type: decision
sources: [docs/plans/2026-10-06-daily-program.md, lessons/0005-daily-program.html]
updated: 2026-10-10
---

Изменение норм создаёт или заменяет правило `{effectiveFrom, targets}` на завтрашний день; сегодняшний и прошлые дни сохраняются. Дни считаются по Asia/Bishkek.

- Допустимо 0–100 игр каждого контроля, 1–500 задач, 0–10 разборов (`normalizeTargets`).
- `configurePractice(practice, today, targets, expectedRevision)` проверяет revision программы; в snapshot ожидающее правило показывается как `program.pending`.
- Новая программа стартует в день первого открытия; старые отметки и мартовский датасет не награждаются за дни до старта. Сегодняшняя цель задач наследуется из старого журнала.
- Все изменения проверяют показанный день сервисом `program.configure {day, targets, expectedRevision}`.
- Риск из плана: неоткрытый сегодняшний день при изменении норм. При системной дате раньше сохранённых тренировок операция отклоняется без потери записей.

Связи: [[plan-stage4-daily-program]], [[stable-reward-ids]], [[practice-transaction]].

Источники: `docs/plans/2026-10-06-daily-program.md`, `lessons/0005-daily-program.html`.
