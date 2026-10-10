---
title: Lichess API, NDJSON и необязательные разрешения
type: concept
sources: [lessons/0004-lichess-api.html, reference/0004-lichess-api.html, reference/0003-history-import.html]
updated: 2026-10-10
---

**Разрешения.** В `manifest.json` объявлены необязательными: origin `https://lichess.org/*` и `data_collection: ['authenticationInfo']` (категория Firefox, включающая имя пользователя; пароль не передаётся). `permissions.request` вызывается прямо в обработчике клика (`ui/sync.js`), до любого `await`, чтобы сохранить действие пользователя. Отказ оставляет журнал доступным; отзыв — `browser.permissions.remove`. Сеть не используется при открытии экрана, только по кнопке.

**Запрос.** Анонимный `GET https://lichess.org/api/games/user/sebajun777`, `Accept: application/x-ndjson`, `credentials: 'omit'`, токен не нужен. Параметры: `since`/`until` (мс Unix), `sort=dateAsc`, `max=200`, `ongoing=true`, `finished=true`. Отбор rated standard bullet/blitz/rapid — локально (`core/sync-state.js`).

**NDJSON.** Один JSON-объект на непустую строку; сетевые куски не совпадают со строками, остаток переносится (`data/lichess-client.js`). Лимиты клиента: 200 строк, 8 МиБ, 30 с; HTTP 429 — пауза не менее минуты (с учётом Retry-After); автоповторов нет.

**Окно и курсор.** `coverageStart` — последняя известная партия минус 7 дней (или 30 дней при пустой истории); `cycleUntil` — фиксированная верхняя граница цикла, окно `[since, until)`; `nextSince` — начало следующей порции; `completedUntil` и `lastSuccessAt` обновляются после порции менее чем из 200 строк. До пяти порций за запуск. Партии и курсор сохраняются одной транзакцией ([[concept-indexeddb-storage]]). «Сегодня» — день начала партии по Asia/Bishkek; до конца цикла счётчики могут быть неполными.

Связано: [[lesson-03-04-history-and-lichess-api]], [[concept-manifest-and-popup]].

Источники: см. frontmatter.
