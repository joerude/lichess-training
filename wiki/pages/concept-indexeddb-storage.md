---
title: IndexedDB: журнал, партии и транзакции
type: concept
sources: [lessons/0003-history-import.html, lessons/0005-daily-program.html, reference/0002-message-and-storage.html, reference/0003-history-import.html, reference/0005-daily-program.html, docs/learning/first-working-addon.md]
updated: 2026-10-10
---

Всё состояние расширения живёт в IndexedDB, доступ — через `data/repository.js`.

**Stores.** `journal` — отметки (запись `state`), с версии 0.4.0 соседний ключ `practice` (нормы, заметки, награды). Схема версии 2 добавила `games`, `ratings`, `historyMeta`, сохранив `journal`. Ключ партии в `games` — `id`.

**Транзакции.** Пакет записывается атомарно, ошибка отменяет всё: импорт истории (`importHistory`), порция API (`saveSyncBatch`: `games` + `historyMeta`, readwrite), `transactPractice` (`state` + `practice`). Ответ даётся по событию `complete` транзакции, а не по успеху отдельного `put`.

**Импорт без повторов.** Предпросмотр ничего не пишет; сохранение — отдельная кнопка. Внутри файла одинаковые нормализованные ID — повтор, противоречащие — ошибка. В базе существующая партия остаётся как была. Месяц в `rating_history` Lichess считается с 0 (март = 2).

**Резервные копии.** V1 — только отметки; V2 — отметки, правила, заметки, награды. Партии, рейтинги и состояние API в копию не входят; историю можно заново импортировать. Весь файл проверяется до транзакции.

См. [[concept-message-passing-and-storage]], [[concept-lichess-api-and-permissions]], [[lesson-03-04-history-and-lichess-api]], [[lesson-05-daily-program-xp]].

Источники: см. frontmatter.
