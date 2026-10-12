---
title: Решение — считать задачи по публичному счётчику профиля
type: decision
sources: [docs/plans/2026-10-12-puzzle-progress-design.md]
updated: 2026-10-12
---

Решение 2026-10-12 (версия 0.4.1, согласовано с владельцем): число решённых задач берётся из публичного профиля `GET https://lichess.org/api/user/sebajun777`, поле `perfs.puzzle.games` (проверено 2026-10-12: `{games: 894, rating: 1861, …}`). Без OAuth, cookies и токена. Общий план этапа: [[plan-0-4-1-puzzle-auto-count]].

## Что выбрано
- Запрос в сеть только по действию пользователя (открытие popup, ↻, ручная отметка или отмена в открытом popup) и не чаще одного раза в 60 с: свежее показание берётся из сохранённого. Фонового опроса нет.
- Тот же клиент, что у партий: общая очередь, таймаут 30 с, пауза после 429, `credentials: 'omit'`, `redirect: 'error'`, `Accept: application/json`, тело до 1 MiB. Результат — целое `perfs.puzzle.games` не меньше 0 или ошибка `no-data`.
- Перед запросом проверяется optional permission `https://lichess.org/*` (`canAccess`); без него запроса нет ([[concept-lichess-api-and-permissions]]).

## Отклонено
| Вариант | Причина |
|---|---|
| Content script на lichess.org/training | Новое разрешение и хрупкая зависимость от DOM Lichess |
| OAuth `puzzle:read` | Оставлен этапу 5 ([[roadmap-stages]]) |
| Фоновый таймер | Запросы без действия пользователя |
| Лента `/api/user/{name}/activity` | Дни по UTC, а у проекта дни по Asia/Bishkek; граница UTC приходится на 06:00 местного времени |

## Цена решения
Засчитываются только задачи под аккаунтом sebajun777 (в любом браузере или приложении), анонимные — нет; счётчик считает все попытки; задачи до первого наблюдения за день не видны. Как с этим живёт расчёт — [[puzzle-daily-baseline]]; отметка и награда — [[day-auto-mark-and-suppression]]. Что даёт `puzzle:read`, описано в [[research-dataset-and-lichess-evidence]].

Источники: `docs/plans/2026-10-12-puzzle-progress-design.md`.
