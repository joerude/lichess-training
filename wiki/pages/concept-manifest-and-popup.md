---
title: Manifest и popup в Firefox addon
type: concept
sources: [lessons/0001-firefox-first-addon.html, reference/0001-manifest-and-popup.html, docs/learning/first-working-addon.md]
updated: 2026-10-10
---

`manifest.json` сообщает Firefox имя, версию и устройство расширения. Ключевые поля из источников:

- `manifest_version` — формат manifest (в примерах 3); `version` — версия самого addon. Это разные значения.
- `name`, `description`.
- `action.default_title` — подсказка кнопки; `action.default_popup` — путь к HTML-карточке; `default_area: navbar`.
- `browser_specific_settings.gecko` — идентификатор addon и `data_collection_permissions` (в уроке 01: `required: ["none"]`).

`popup.html` — содержимое карточки; имя файла выбирает автор, но оно должно совпадать с путём в manifest. Переименование popup требует правки пути в manifest, смена текста задания — правки HTML.

Popup создаётся при открытии и закрывается при потере фокуса; основной экран (dashboard) живёт во вкладке. В рабочем addon manifest также задаёт фоновую страницу и необязательные разрешения (см. [[concept-lichess-api-and-permissions]]).

Цикл изменения: изменить файл → сохранить → Reload в `about:debugging` → открыть карточку → проверить. Временная установка действует до перезапуска Firefox.

Связано: [[lesson-01-02-manifest-popup-storage]], [[concept-message-passing-and-storage]].

Источники: см. frontmatter.
