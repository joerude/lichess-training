---
title: Архитектура и модули расширения
type: module
sources: [docs/architecture.md, docs/plans/2026-10-12-puzzle-progress-design.md, docs/plans/2026-10-12-puzzle-progress.md]
updated: 2026-10-12
---

# Архитектура расширения

Принцип: интерфейс отправляет небольшие команды и получает готовое состояние. Все изменения тренировочной базы идут через один модуль управления. Правила заданий получают данные и даты явно и не обращаются к браузеру или сети. Модули — обычные функции, без движка плагинов, очереди фоновых заданий и подписок. Хранение: [[data-storage-model]].

```text
UI (popup, основной экран) -> app/training -> core (правила, XP)
                                   |-> data/repository (IndexedDB)
                                   |-> integration/lichess-api
dataset-import -> app ; background (события Firefox) -> app
```

## Модули

| Модуль | Ответственность |
|---|---|
| `ui` | Popup и разделы основного экрана: показать состояние, отправить команду |
| `background` | Слушатели Firefox, передача команд; позднее alarm |
| `training` (app) | Координация операций, единственный владелец изменений |
| `training-engine` (core) | Фильтры партий, день программы, выполнение заданий, право на награду |
| `repository` (data) | База, версии схемы, транзакции, резервные копии |
| `lichess-api` (integration) | HTTP, NDJSON, ошибки сети, последовательные запросы |
| `dataset-import` | Проверка локального файла и преобразование записей |

Импорт и API используют одну функцию нормализации партий (`normalize-game.js`).

Планируемая структура: `extension/{manifest.json, background.js, ui/, app/, core/, data/, integration/}`, а также `lessons/` и `reference/`.

## Добавлено в 0.4.0
- `core/practice-engine.js` — по журналу, программе и нормализованным играм вычисляет выполнение, будущие нормы, заметки и награды.
- `core/practice-backup.js` — полная проверка бэкапов V1/V2 до записи.
- `app/practice.js` — команды program; сохранение через общую транзакцию. Старые training-команды идут тем же путём через общий маршрут сервисов.
- В repository: `transactPractice` читает journal/games/historyMeta вместе и атомарно пишет state + practice.

## Добавлено в 0.4.1
Автоподсчёт задач ([[plan-0-4-1-puzzle-auto-count]]): задание «задачи» засчитывается по публичному счётчику профиля, без OAuth и cookies; ручная отметка остаётся.
- `data/lichess-client.js` — `fetchPuzzleCount()`: те же очередь, таймаут 30 с и пауза после 429, что у загрузки партий; тело профиля не больше 1 MiB ([[concept-lichess-api-and-permissions]]).
- `core/puzzle-progress.js` — чистые правила: показание за сегодня переиспользуется 60 с, первое показание дня по Бишкеку задаёт точку отсчёта, счётчик ниже неё начинает счёт заново, при достижении нормы ставится автоотметка ([[puzzle-daily-baseline]]).
- `app/puzzles.js` — команда `puzzles.refresh`: проверяет optional permission и при необходимости запрашивает счётчик; затем `recordPuzzleCount` из `app/practice.js` одной транзакцией `transactPractice` пишет показание в `historyMeta['puzzles']`, автоотметку дня и награду ([[practice-transaction]]). Одновременные вызовы делят один запрос. Маршрут `puzzles.*` — в `app/services.js`, неизвестная команда отклоняется.
- `core/training-engine.js`, `core/practice-engine.js` — необязательные поля дня `source: 'auto'` и `autoSuppressed: true`; задание «задачи» знает, что отмечено автоматически ([[day-auto-mark-and-suppression]]).
- `ui/puzzle-card.js` — карточка popup: «N / норма», полоса, фраза поддержки, «счёт с ЧЧ:ММ · обновлено ЧЧ:ММ». Popup вызывает `puzzles.refresh` при открытии, по ↻ и после ручной отметки или отмены; фонового опроса нет.

Сообщение `puzzles.refresh` возвращает `{ status, date, solved, target, baselineAt, observedAt, completed, source, autoCompleted, reason }`; `reason` — текст ошибки запроса при `offline`, `rate-limited` или `no-data` (карточка показывает его подсказкой у строки времени), иначе `null`. `status` — `'ok'`, `'no-permission'`, `'offline'`, `'rate-limited'` или `'no-data'`; `autoCompleted: true`, если отметку поставил этот вызов (тогда popup перечитывает карточку тренировки и строку программы); `solved`, `baselineAt`, `observedAt` равны `null`, если показания за сегодня нет. Выбор источника: [[decision-public-puzzle-counter]].

## Пользовательские разделы
Единая страница расширения: «Сегодня», «Программа», «Прогресс», «Разборы», «Настройки». Popup показывает краткий прогресс дня, XP/уровень, время последней синхронизации и открывает эту страницу. В интерфейсе различаются выполнение из истории Lichess и собственная отметка пользователя.

## Firefox MV3
Фоновые scripts/event pages: состояние восстанавливается из базы при повторном запуске, слушатели регистрируются сразу, база открывается внутри обработчиков.

## Разрешения
IndexedDB не требует `storage`. Сеть — необязательный `https://lichess.org/*`, плюс необязательная декларация `authenticationInfo` (передача имени профиля). Кнопка запрашивает оба разрешения непосредственно в пользовательском действии, до первого await; фон проверяет их перед каждой порцией. Отказ и отзыв останавливают загрузку. Для будущего OAuth проверяется `identity`.

## Разбор партий
Используются инструменты Lichess; собственная доска и движок не нужны. Помощь с ходами текущей партии не входит в сценарий.

> ⚠ Противоречие: в разделе «Архитектура» файл `core/training-engine.js` и `app/training.js` названы основой, а раздел «Реализация программы в 0.4.0» вводит `core/practice-engine.js`, `core/practice-backup.js`, `app/practice.js`; предлагаемая структура каталога (docs/architecture.md) их не перечисляет. Относить ли `training-engine` и `practice-engine` к одному модулю — документ не уточняет.

Связано: [[mission-and-constraints]], [[decisions-platform-and-storage]].

## Источники
- docs/architecture.md
