---
title: Транзакция repository.transactPractice
type: decision
sources: [docs/plans/2026-10-06-daily-program.md, lessons/0005-daily-program.html, docs/plans/2026-10-12-puzzle-progress-design.md, docs/plans/2026-10-12-puzzle-progress.md]
updated: 2026-10-12
---

Связанные данные (отметка задач в `journal.state` и программа в `journal.practice`) сохраняются атомарно: `repository.transactPractice(update)` читает `{journal, practice, games, sync, puzzles}` (`puzzles` — с 0.4.1) одной readwrite-транзакцией по stores journal, games и historyMeta.

- Updater синхронный и возвращает `{journal, practice}`; обе записи journal сохраняются вместе.
- Ответ с сохранёнными записями и прочитанными фактами возвращается после события `complete` транзакции, а не после отдельного `put`.
- Ошибка отменяет обе записи. Сеть внутри транзакции не используется.
- Загрузка партий из API сохраняет игры и курсор своей транзакцией; награды затем пересчитываются локально. Если экран закрыт между этими шагами, следующее чтение восстановит награды из сохранённых фактов; эта операция не продвигает курсор API.
- Версия IndexedDB остаётся 2; добавляется только ключ `practice` в store `journal` (в 0.4.1 — ещё ключ `puzzles` в `historyMeta`).
- 0.4.1: показание счётчика задач, автоотметка дня и награда всегда пишутся этой же транзакцией; сети внутри по-прежнему нет, запрос к Lichess идёт до неё. Показание записывается, только если updater вернул новый объект `puzzles`: тот же объект, что был прочитан, или его отсутствие запись не трогают, значение не-объект отменяет транзакцию. `recordPuzzleCount(instant, count)` в `app/practice.js` при `count === null` берёт сохранённое показание и возвращает `autoCompleted`; прочитанные факты (игры, sync, счётчик) в итоговой записи остаются рядом с пересчитанными, чтобы показание дошло до репозитория ([[puzzle-daily-baseline]], [[day-auto-mark-and-suppression]]).

Связи: [[concept-indexeddb-storage]], [[stable-reward-ids]], [[plan-stage4-daily-program]], [[plan-0-4-1-puzzle-auto-count]].

Источники: `docs/plans/2026-10-06-daily-program.md`, `lessons/0005-daily-program.html`, `docs/plans/2026-10-12-puzzle-progress-design.md`, `docs/plans/2026-10-12-puzzle-progress.md`.
