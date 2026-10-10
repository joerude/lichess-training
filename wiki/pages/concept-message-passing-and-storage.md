---
title: Передача сообщений и хранение отметки
type: concept
sources: [lessons/0002-persisted-training.html, reference/0002-message-and-storage.html, docs/learning/first-working-addon.md]
updated: 2026-10-10
---

Интерфейс (popup, dashboard) не пишет в базу напрямую: он отправляет команду, которую принимает фоновая страница.

Путь команды: `ui/page.js` (общая карточка) → `ui/client.js` (`browser.runtime.sendMessage`, распаковка успеха/ошибки) → `background.js` + `background-transport.js` (проверка отправителя) → `app/services.js` (маршрут `training.*` / `history.*` / ...) → `app/training.js` → `data/repository.js` → IndexedDB. Правила дат — в `core/training-engine.js`.

Команда выполнения: `{ type: "training.setCompletion", day: "2026-10-04", completed: true }`. Поле `day` — дата, показанная на экране, по часовому поясу программы; оно защищает от клика в устаревшем экране после полуночи.

Принципы из источников:
- Источник прогресса — IndexedDB; переменные страницы временные. Popup и фоновая страница могут выгружаться.
- Успех показывается после завершённой транзакции, а не после смены текста кнопки.
- Повтор команды не создаёт вторую запись дня.
- Экспорт создаёт файл; восстановление заменяет журнал после проверки.

См. также [[concept-indexeddb-storage]], [[lesson-01-02-manifest-popup-storage]], [[concept-manifest-and-popup]].

Источники: см. frontmatter.
