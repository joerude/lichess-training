---
title: Формат резервной копии v2 и импорт v1
type: decision
sources: [docs/plans/2026-10-06-daily-program.md, lessons/0005-daily-program.html, docs/plans/2026-10-12-puzzle-progress-design.md, docs/plans/2026-10-12-puzzle-progress.md]
updated: 2026-10-12
---

Новый экспорт: `{format:'lichess-training-backup', version:2, exportedAt, state:<legacy journal>, practice}`.

- Лимиты: v2 до 16 МиБ, до 10 000 правил и 50 000 наград; v1 по-прежнему принимается до 2 МиБ. Уровень не хранится.
- Проверка до транзакции нормализует только известные поля, даты, лимиты, уникальность ID, версии и профиль.
- V1: заменяет старый журнал отметок, сохраняет уже существующую программу и разборы, пересчитывает XP за отметки; если программы нет — создаёт её из восстановленного журнала.
- V2: заменяет журнал, программу, заметки и награды вместе; обновляет версии правил и заметок, отклоняя черновики до замены.
- Games, ratings и sync metadata обе версии оставляют на месте.
- Диалог показывает состав замены до подтверждения; `training.previewImport` проверяет файл без записи.
- 0.4.1: v2 переносит и восстанавливает новые необязательные поля дня внутри `state.days[]`: `source` (`'manual'` или `'auto'`, только у отмеченного дня) и `autoSuppressed` (только `true`). Формат и номер версии не менялись; копии 0.4.0 без этих полей остаются валидными. Проверка отклоняет неизвестный `source`, `source` у неотмеченного дня и `autoSuppressed`, не равный `true`.
- Показание счётчика задач `historyMeta['puzzles']`, как games, ratings и sync metadata, в копию не входит и при восстановлении остаётся на месте (вывод: v2 по описанию состоит из `state` и `practice`, в спецификации показание в формат не добавлено). Последствия для автоотметки — [[day-auto-mark-and-suppression]].

Связи: [[stable-reward-ids]], [[practice-transaction]], [[plan-stage4-daily-program]], [[plan-0-4-1-puzzle-auto-count]].

Источники: `docs/plans/2026-10-06-daily-program.md`, `lessons/0005-daily-program.html`, `docs/plans/2026-10-12-puzzle-progress-design.md`, `docs/plans/2026-10-12-puzzle-progress.md`.
