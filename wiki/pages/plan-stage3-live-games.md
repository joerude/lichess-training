---
title: План этапа 3 — свежие партии из Lichess (0.3.0)
type: decision
sources: [docs/plans/2026-10-06-live-games.md]
updated: 2026-10-10
---

Версия 0.3.0: обновление по кнопке и число завершённых rated standard партий bullet/blitz/rapid за сегодня (Бишкек). Партии добавляются/обновляются по game ID, отметки задач остаются ручными. Основа: [[plan-stage2-history-import]]; ограничения API: [[research-dataset-and-lichess-evidence]]. Все пункты выполнены.

## Сетевой контракт
- `createLichessClient` → `fetchGamesPage`: GET `/api/games/user/sebajun777`, `sort=dateAsc`, NDJSON, `credentials: omit`, без токена. Фильтр rated/perf применяется локально.
- Строго последовательные запросы; HTTP 429 — пауза не менее 60 с (учитывается Retry-After), хранится в базе; автоповторов нет. Порция — до 200 строк и 8 МиБ, повреждённый ответ отклоняется целиком.
- Firefox запрашивает optional host `https://lichess.org/*` и optional data collection `authenticationInfo` перед запросом; отказ оставляет локальные функции.

## Покрытие
Нижняя граница — последняя партия минус 7 дней (или 30 дней без истории), фиксируется при первой записи состояния. Каждый цикл заново просматривает окно; курсор — последний createdAt, ID убирает повтор. Кнопка берёт до пяти порций, сохранённое не теряется при закрытии. Окно — не доказательство полноты для более ранних партий; старую историю даёт импорт.

## Хранение
Схема v2, ключ `sync` в `historyMeta` (`revision`, `coverageStart`, `cycleUntil`, `nextSince`, `completedUntil`, `lastSuccessAt`, `retryAfter`). `saveSyncBatch` с `expectedRevision` защищает от устаревшего курсора. Старый lastMoveAt запись не заменяет; пропущенные поля данные не стирают. Счётчик «сегодня» относится ко дню начала партии.

Следующий этап: [[plan-stage4-daily-program]]. OAuth, нормы, XP и фоновые обновления оставлены на потом.

Источники: `docs/plans/2026-10-06-live-games.md`.
