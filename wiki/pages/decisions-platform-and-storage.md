---
title: Решения Firefox, JS, IndexedDB, локальный профиль
type: decision
sources: [MISSION.md, NOTES.md, docs/architecture.md]
updated: 2026-10-10
---

# Решения: платформа, язык, хранилище, профиль

| Решение | Суть | Источник |
|---|---|---|
| Firefox | Первая платформа, выбрана пользователем 4 октября 2026; Chrome — возможное расширение позже | MISSION.md, architecture.md |
| JavaScript + ES modules | Рабочее решение: обычный JS, HTML, CSS; без сборщика | NOTES.md |
| IndexedDB | Структурированные записи, индексы, транзакции; все данные прогресса в одной базе | architecture.md |
| Локальный профиль | Один Lichess-аккаунт (`sebajun777`), одна локальная база; собственный сервер — только если понадобится синхронизация между устройствами | NOTES.md, architecture.md |
| Часовой пояс | `Asia/Bishkek` | NOTES.md |
| Начальное задание | 10 задач; позже шаблон 5 Bullet, 5 Blitz, 10 задач, 1 разбор | NOTES.md |
| Исходный датасет | Файлы не изменяются | NOTES.md |

> ⚠ Противоречие: architecture.md (стартовый вариант) говорит, что «нужность TypeScript и сборщика уточняется по опыту пользователя», тогда как NOTES.md фиксирует обычный JavaScript с ES modules как рабочее решение. Считать TypeScript отложенным вопросом, а не принятым решением.

> ⚠ Противоречие: architecture.md в «Решениях для следующего обсуждения» оставляет открытыми вопросы о месте программы (вкладка + popup) и локальном профиле, а в тексте этапа 1 они уже приняты («вкладка расширения, краткий popup и локальный профиль»; NOTES: «okay lets go»).

Подробнее: [[data-storage-model]], [[architecture-overview]], [[mission-and-constraints]].

## Источники
- MISSION.md
- NOTES.md
- docs/architecture.md
