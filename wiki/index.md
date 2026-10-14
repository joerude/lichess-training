# Вики lichess-training

Каталог страниц. Обновляется при каждом ingest.

## Страницы
- [[architecture-overview]] — Архитектура и модули расширения.
- [[backup-format-v2]] — Формат резервной копии v2 и импорт v1.
- [[concept-indexeddb-storage]] — IndexedDB: журнал, партии и транзакции.
- [[concept-lichess-api-and-permissions]] — Lichess API, NDJSON и необязательные разрешения.
- [[concept-manifest-and-popup]] — Manifest и popup в Firefox addon.
- [[concept-message-passing-and-storage]] — Передача сообщений и хранение отметки.
- [[data-storage-model]] — Модель данных и хранение.
- [[day-auto-mark-and-suppression]] — Автоотметка дня (`source: 'auto'`) и запрет автоподсчёта после ручной отмены (0.4.1).
- [[decision-configurable-profile]] — Свой профиль Lichess и часовой пояс, первый запуск, смена профиля (0.5.0).
- [[decision-public-puzzle-counter]] — Решение: задачи считаются по публичному счётчику профиля (0.4.1).
- [[decision-scoresheet-style]] — Оформление «Турнирный бланк»: палитра, шрифты PT, компактный интерфейс.
- [[decisions-platform-and-storage]] — Решения Firefox, JS, IndexedDB, локальный профиль.
- [[lesson-01-02-manifest-popup-storage]] — Уроки 01-02 и первое изменение addon: от manifest к сохранённой отметке.
- [[lesson-03-04-history-and-lichess-api]] — Уроки 03-04: импорт истории и загрузка партий через Lichess API.
- [[lesson-05-daily-program-xp]] — Урок 05: ежедневная программа, XP и стабильные ID наград.
- [[manual-qa-procedure]] — Порядок ручной проверки в Firefox.
- [[mission-and-constraints]] — Цели и ограничения проекта.
- [[plan-0-4-1-puzzle-auto-count]] — План этапа 0.4.1 — автоподсчёт задач и прогресс в popup.
- [[plan-stage1-first-training-loop]] — План этапа 1 — первый тренировочный цикл.
- [[plan-stage2-history-import]] — План этапа 2 — импорт истории и статистика.
- [[plan-stage3-live-games]] — План этапа 3 — свежие партии из Lichess (0.3.0).
- [[plan-stage4-daily-program]] — План этапа 4 — ежедневная программа, разборы, награды (0.4.0).
- [[practice-rules-tomorrow]] — Изменения норм действуют с завтра.
- [[practice-transaction]] — Транзакция repository.transactPractice.
- [[project-overview]] — Обзор проекта.
- [[puzzle-daily-baseline]] — Точка отсчёта задач за день по Бишкеку (0.4.1).
- [[research-dataset-and-lichess-evidence]] — Исследование — данные и технические основания.
- [[research-discovery-map]] — Исследование — рабочая карта проекта (discovery).
- [[review-stage1]] — Ревью этапа 1 (независимое).
- [[review-stage4]] — Ревью этапа 4 (независимое, 0.4.0).
- [[roadmap-stages]] — Этапы разработки и обучения.
- [[stable-reward-ids]] — Стабильные ID наград и расчёт уровня.
- [[verification-status]] — Статус проверок.

## Источники, ожидающие ingest
Нет. Все источники (`MISSION.md`, `NOTES.md`, `docs/architecture.md`, `docs/verification.md`, `docs/manual-qa.md`, `docs/research/*`, `docs/plans/*`, `docs/reviews/*`, `lessons/*`, `reference/*`) указаны в `sources:` страниц `wiki/pages/` (проверено 2026-10-12, после ingest 0.4.1).
