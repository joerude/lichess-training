# Firefox WebExtensions Resources

Проверено 4 октября 2026. Основные источники для будущих занятий.

## Knowledge

- [MDN: Your first extension](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Your_first_WebExtension)
  Первый небольшой addon: manifest, локальная загрузка и изменение поведения. Использовать для первого знакомства с циклом разработки.
- [MDN: Anatomy of an extension](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Anatomy_of_a_WebExtension)
  Назначение manifest, страниц расширения, фоновых скриптов и content scripts. Использовать для объяснения границ компонентов.
- [MDN: action](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/action)
  Кнопка браузера, путь default_popup и подсказка default_title. Использовать в первом уроке и при изменении интерфейса addon.
- [Mozilla Extension Workshop: Temporary installation in Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
  Загрузка через about:debugging, Reload и отличия временной установки от обычной. Использовать для ручной проверки и отладки учебных изменений.

## Knowledge: сообщения и хранение

- [MDN: runtime.sendMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)
  Запрос страницы к фоновому обработчику и асинхронный ответ. Основа урока 02.
- [MDN: background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
  Firefox event pages, ES modules и регистрация обработчиков; состояние страницы не заменяет постоянное хранение.
- [MDN: IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
  Объектная база, индексы и транзакции. Основа сохранения прогресса и последующего импорта партий.
- [Mozilla: web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
  Проверка manifest, временный запуск и упаковка addon; используется как инструмент разработки.

## Wisdom (Communities)

Потребность в обсуждениях с сообществом пока не определена.

## Gaps

- Опыт пользователя с JavaScript/TypeScript ещё неизвестен; дополнительные ресурсы подберём по ответу.
- OAuth и постоянная установка будут отдельными темами после первых локальных занятий.
