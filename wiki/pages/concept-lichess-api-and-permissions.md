---
title: Lichess API, NDJSON и необязательные разрешения
type: concept
sources: [lessons/0004-lichess-api.html, reference/0004-lichess-api.html, reference/0003-history-import.html, docs/plans/2026-10-12-puzzle-progress-design.md, docs/plans/2026-10-12-puzzle-progress.md, docs/plans/2026-10-06-live-games.md]
updated: 2026-10-12
---

**Разрешения.** В `manifest.json` объявлены необязательными: origin `https://lichess.org/*` и `data_collection: ['authenticationInfo']` (категория Firefox, включающая имя пользователя; пароль не передаётся). `permissions.request` вызывается прямо в обработчике клика (`ui/sync.js`), до любого `await`, чтобы сохранить действие пользователя. Отказ оставляет журнал доступным; отзыв — `browser.permissions.remove`. Сеть не используется при открытии экрана, только по кнопке.

**Запрос.** Анонимный `GET https://lichess.org/api/games/user/sebajun777`, `Accept: application/x-ndjson`, `credentials: 'omit'`, токен не нужен. Параметры: `since`/`until` (мс Unix), `sort=dateAsc`, `max=200`, `ongoing=true`, `finished=true`. Отбор rated standard bullet/blitz/rapid — локально (`core/sync-state.js`).

**NDJSON.** Один JSON-объект на непустую строку; сетевые куски не совпадают со строками, остаток переносится (`data/lichess-client.js`). Лимиты клиента: 200 строк, 8 МиБ, 30 с; HTTP 429 — пауза не менее минуты (с учётом Retry-After); автоповторов нет.

**Окно и курсор.** `coverageStart` — последняя известная партия минус 7 дней (или 30 дней при пустой истории); `cycleUntil` — фиксированная верхняя граница цикла, окно `[since, until)`; `nextSince` — начало следующей порции; `completedUntil` и `lastSuccessAt` обновляются после порции менее чем из 200 строк. До пяти порций за запуск. Партии и курсор сохраняются одной транзакцией ([[concept-indexeddb-storage]]). «Сегодня» — день начала партии по Asia/Bishkek; до конца цикла счётчики могут быть неполными.

**Счётчик задач (0.4.1).** Анонимный `GET https://lichess.org/api/user/sebajun777`, `Accept: application/json`, `credentials: 'omit'`, `redirect: 'error'`, без `Authorization`. `fetchPuzzleCount()` возвращает целое `perfs.puzzle.games` или ошибку `no-data` (поля нет, значение не целое ≥ 0, JSON не разобран). Нужно то же optional-разрешение `https://lichess.org/*`: фон проверяет его через `canAccess` перед запросом, без него запроса нет (статус `no-permission`). Запрос идёт через общую с партиями очередь, с тем же таймаутом 30 с, телом не больше 1 MiB и общей паузой после 429 (`Retry-After`, минимум 60 с), которая живёт в памяти фоновой страницы. Сеть — только по действию пользователя в popup и не чаще раза в 60 с ([[puzzle-daily-baseline]]); выбор источника — [[decision-public-puzzle-counter]].

**Два уровня паузы 429.** Это не противоречие между спецификацией 0.4.1 («в памяти фоновой страницы») и планом этапа 3 («в базе», [[plan-stage3-live-games]]): по коду (сверено 2026-10-12) это две разные паузы. Клиент `data/lichess-client.js` держит `retryAt` в памяти, и эта пауза общая для партий и счётчика задач. Сервис синхронизации партий (`app/sync.js`) дополнительно сохраняет свою паузу в `historyMeta['sync'].retryAfter` и проверяет её перед загрузкой. `puzzles.refresh` сохранённую паузу не читает, поэтому после выгрузки фоновой страницы счётчик может сделать запрос раньше её окончания: Lichess снова ответит 429, и карточка покажет «данные могли устареть».

Связано: [[lesson-03-04-history-and-lichess-api]], [[concept-manifest-and-popup]].

Источники: см. frontmatter.
