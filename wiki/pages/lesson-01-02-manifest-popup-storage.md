---
title: Уроки 01-02 и первое изменение addon: от manifest к сохранённой отметке
type: source-summary
sources: [lessons/0001-firefox-first-addon.html, lessons/0002-persisted-training.html, reference/0001-manifest-and-popup.html, reference/0002-message-and-storage.html, docs/learning/first-working-addon.md]
updated: 2026-10-10
---

Первые два урока и сопутствующее руководство `first-working-addon.md` ведут от минимального addon до сохранения отметки тренировки.

**Урок 01.** Учебный addon из двух файлов (`manifest.json` и `popup.html`, каталог `practice/lesson-01`) показывает карточку «Решить 5 задач». Загрузка: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on. После правки файлов нужен Reload. Подробности о полях — в [[concept-manifest-and-popup]].

**Урок 02.** Отметка тренировки проходит путь «кнопка → сообщение → сервис в фоновой странице → транзакция IndexedDB → ответ». Подробности — в [[concept-message-passing-and-storage]]. Практика: поменять заголовок в `extension/ui/popup.html`, сделать Reload и убедиться, что отметка осталась, а заголовок основного экрана не изменился (разные HTML-страницы, общий сервис данных).

**first-working-addon.md** даёт карту файлов (manifest, popup, dashboard, `ui/page.js`, `ui/client.js`, background, `app/services.js`, `app/training.js`, `core/training-engine.js`, `data/repository.js`), два упражнения (граница интерфейса; трассировка `training.setCompletion`) и практику резервной копии (экспорт JSON, снятие отметки, восстановление через предпросмотр; восстановление заменяет журнал).

Продолжение: [[lesson-03-04-history-and-lichess-api]], затем [[lesson-05-daily-program-xp]].

> Статус освоения: источники описывают упражнения и вопросы самопроверки, но не подтверждают, что пользователь их выполнил. `first-working-addon.md` прямо говорит, что освоение будет записано в NOTES только после практической проверки.

Источники: см. frontmatter.
