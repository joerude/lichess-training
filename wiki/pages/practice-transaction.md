---
title: Транзакция repository.transactPractice
type: decision
sources: [docs/plans/2026-10-06-daily-program.md, lessons/0005-daily-program.html]
updated: 2026-10-10
---

Связанные данные (отметка задач в `journal.state` и программа в `journal.practice`) сохраняются атомарно: `repository.transactPractice(update)` читает `{journal, practice, games, sync}` одной readwrite-транзакцией по stores journal, games и historyMeta.

- Updater синхронный и возвращает `{journal, practice}`; обе записи journal сохраняются вместе.
- Ответ с сохранёнными записями и прочитанными фактами возвращается после события `complete` транзакции, а не после отдельного `put`.
- Ошибка отменяет обе записи. Сеть внутри транзакции не используется.
- Загрузка партий из API сохраняет игры и курсор своей транзакцией; награды затем пересчитываются локально. Если экран закрыт между этими шагами, следующее чтение восстановит награды из сохранённых фактов; эта операция не продвигает курсор API.
- Версия IndexedDB остаётся 2; добавляется только ключ `practice` в store `journal`.

Связи: [[concept-indexeddb-storage]], [[stable-reward-ids]], [[plan-stage4-daily-program]].

Источники: `docs/plans/2026-10-06-daily-program.md`, `lessons/0005-daily-program.html`.
