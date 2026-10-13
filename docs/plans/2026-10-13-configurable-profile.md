# Свой профиль Lichess и часовой пояс (0.5.0)

Дата: 2026-10-13. Статус: решение владельца — проект открывается (MPL-2.0), расширением должен пользоваться любой человек.

## Проблема

Логин `sebajun777` и часовой пояс `Asia/Bishkek` зашиты в ядре (`core/training-engine.js`, `core/practice-engine.js`), клиенте Lichess (`data/lichess-client.js`), разборе партий (`data/normalize-game.js`, `data/dataset-import.js`), форматтерах интерфейса и статичных текстах. Для другого человека расширение бесполезно.

## Решение

- **Профиль** — `{ username, timeZone }`, хранится там же, где и сейчас: в `journal.profile`. `username` — логин Lichess в нижнем регистре (2–30 символов, `A–Z a–z 0–9 _ -`, начинается и заканчивается буквой или цифрой). `timeZone` — идентификатор IANA, который принимает `Intl.DateTimeFormat`.
- **Первый запуск**: профиля нет — основной экран показывает форму «Логин на Lichess» + «Часовой пояс» (по умолчанию системный пояс, список из `Intl.supportedValuesOf('timeZone')`). Popup вместо карточки показывает «Укажите свой логин Lichess» и кнопку перехода на основной экран.
- **Существующие пользователи** не замечают изменений: их журнал уже содержит `profile`.
- **Смена профиля** — раздел «Профиль» на основном экране: логин и пояс, кнопка «Сменить профиль». Смена стирает все локальные данные (отметки, программу, разборы, награды, партии, рейтинги, курсор загрузки) после явного подтверждения (ввести слово `удалить`); перед этим предлагается «Скачать JSON».
- **Копия**: восстанавливается только в тот же профиль (как сейчас). Чтобы перенести журнал на другой компьютер — сначала указать тот же логин и пояс, затем «Восстановить из файла».
- **Онлайн-проверки логина нет**: доступ к lichess.org выдаётся позже кнопкой «Подключить Lichess»; неверный логин проявится ошибкой загрузки (HTTP 404).

## Архитектура

- `extension/core/profile.js` (новый):
  - `normalizeProfile(input) → { username, timeZone }` — проверка и нормализация, иначе `Error` с понятным русским текстом;
  - `setActiveProfile(profile)`, `clearActiveProfile()`, `hasActiveProfile()`, `activeProfile()` — модульное состояние фоновой части; `activeProfile()` без профиля бросает `Error('Сначала укажите свой логин Lichess.')` с `error.code = 'profile-required'`;
  - `dayStart(day, timeZone) → number` — момент локальной полуночи дня `YYYY-MM-DD` в поясе (учитывая смещение и переходы времени).
- Ядро и данные берут профиль из `activeProfile()`:
  - `trainingDay(date)` → `dayKey(date, activeProfile().timeZone)`; `initialState(today)` пишет активный профиль; `normalizeBackup` сверяет профиль копии с активным;
  - `eligibleGames` сравнивает с `activeProfile().username`; `startOfToday` в `practiceSnapshot` — через `dayStart(today, timeZone)`;
  - `normalizeGame`/`normalizeGameCandidate`/`parseDataset` получают логин параметром без значения по умолчанию; вызывающие (`core/sync-state.js`, `app/history.js`) передают `activeProfile().username`;
  - `createLichessClient({ …, username = () => activeProfile().username })` строит адреса `https://lichess.org/api/games/user/<логин>` и `https://lichess.org/api/user/<логин>` при каждом запросе (`encodeURIComponent`).
- Сервисы (`app/services.js`):
  - новые команды `profile.get` → `{ profile: { username, timeZone } | null }`, `profile.setup` `{ username, timeZone }` → создаёт журнал с профилем, если журнала нет (иначе ошибка «Профиль уже задан»), `profile.reset` `{ confirm: 'удалить' }` → `repository.clearAll()` и `clearActiveProfile()`;
  - перед любой другой командой профиль загружается из `journal.profile` (один раз, потом кэш); нет профиля — ошибка с `code: 'profile-required'`.
- `data/repository.js`: `clearAll()` — одна транзакция очищает `journal`, `games`, `ratings`, `historyMeta`.
- Транспорт: `background-transport.js` добавляет в ответ об ошибке `code`, если он есть; `ui/client.js` переносит `code` в брошенную ошибку.
- Интерфейс:
  - форматтеры времени и дат (`ui/practice.js`, `ui/puzzle-card.js`, `ui/history-view.js`, `ui/sync.js`, `ui/dashboard.js`, `ui/page.js`) используют пояс профиля из снимка (`snapshot.profile.timeZone`), а не константу; подписи «(Бишкек)» заменяются короткой меткой пояса (`timeZoneName: 'shortOffset'`, например «GMT+6»);
  - статичные тексты без логина: заголовок страницы, `#username` по умолчанию «—», копия импорта, подвал, текст согласия; `manifest.json` → описание без логина.
- Тесты: `tests/setup.js` выставляет профиль `sebajun777` / `Asia/Bishkek` для всех существующих тестов (`node --import ./tests/setup.js --test tests/*.test.js`). Новые тесты используют и другой профиль (например `magnus_fan` / `America/New_York`).

## Задачи

1. **Ядро профиля**: `core/profile.js`, переход ядра и разбора партий на активный профиль, `dayStart`, `tests/setup.js`, тесты профиля и дня в другом поясе. Поведение для `sebajun777`/Бишкека не меняется.
2. **Сервис и транспорт**: клиент Lichess с логином профиля, команды `profile.*`, загрузка и проверка профиля перед командами, `repository.clearAll()`, `code` в ответах и ошибках клиента, тесты.
3. **Интерфейс**: форма первого запуска, раздел «Профиль» со сменой, подсказка в popup, форматтеры по поясу профиля, тексты без логина, описание в manifest, тесты UI.
4. **Проверка и выпуск**: `scripts/firefox-smoke.mjs` проходит первый запуск (форма профиля) и получает сценарий `profile`; версия 0.5.0; README, `docs/architecture.md`, `docs/manual-qa.md`, `docs/verification.md`.

## Готово, когда

- Новый пользователь ставит расширение, вводит свой логин и пояс и получает рабочий журнал без упоминаний `sebajun777`.
- Данные существующего пользователя (`sebajun777`, Бишкек) открываются без изменений.
- `npm test`, `npm run lint:addon`, `npm run smoke:firefox` — без провалов.
