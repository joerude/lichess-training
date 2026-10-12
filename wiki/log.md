# Журнал вики

Только дописывать в конец. Формат: `## [YYYY-MM-DD] операция | заголовок`.

## [2026-10-10] setup | Создан wiki-flow

## [2026-10-10] ingest | План 0.4.0: ежедневная программа
Саммари плана уже существовало (`plan-stage4-daily-program`), дубль не создавался. Добавлены страницы `stable-reward-ids`, `practice-transaction`, `backup-format-v2`, `practice-rules-tomorrow`.
Обновлены `project-overview` (ссылки) и `index.md` (в индекс добавлены все страницы).

## [2026-10-10] ingest | Ревью и проверка 0.4.0
Добавлена `review-stage4`; обновлены `verification-status` (статус 0.4.0, снято прежнее противоречие), `plan-stage4-daily-program` (дополнена пометка ⚠) и `index.md`.
Утверждений про coverage.partial в других страницах нет, они не менялись.

## [2026-10-12] lint | Полная проверка вики
Проверено 27 страниц: битых wiki-ссылок, сирот, страниц вне `index.md`, страниц без frontmatter и ссылок `sources:` на несуществующие файлы нет. Единственная проблема: раздел «Источники, ожидающие ingest» в `index.md` устарел. Противоречий между источниками не найдено.

## [2026-10-12] ingest | Сверка ожидающих источников
Каждый источник (MISSION, NOTES, architecture, verification, manual-qa, research, plans, reviews, lessons, reference) сверен с полем `sources:` страниц. Невнесённых нет: `lessons/0005`, `reference/0005` покрыты `lesson-05-daily-program-xp`, `docs/plans/2026-10-06-live-games.md` — `plan-stage3-live-games`. Новые страницы не создавались; раздел ожидающих в `index.md` заменён на «Нет».

## [2026-10-12] ingest | Автоподсчёт задач 0.4.1
Новые страницы: `plan-0-4-1-puzzle-auto-count` (саммари спецификации и плана), `decision-public-puzzle-counter`, `puzzle-daily-baseline`, `day-auto-mark-and-suppression`. Источники: `docs/plans/2026-10-12-puzzle-progress-design.md`, `docs/plans/2026-10-12-puzzle-progress.md`; факты 0.4.1 из `docs/verification.md`, `docs/manual-qa.md`, `docs/architecture.md`.
Обновлены: `verification-status`, `roadmap-stages`, `manual-qa-procedure`, `architecture-overview`, `data-storage-model`, `practice-transaction`, `concept-lichess-api-and-permissions`, `backup-format-v2`, `stable-reward-ids`, `project-overview`, `index.md`.
Противоречие на `verification-status`: «34 продуктовых файла» для 0.4.0 в `docs/verification.md` против измеренных 30 файлов (`unzip -Z1 dist/lichess-training-0.4.0.zip`, проверено 2026-10-12). Помечены также расхождения плана 0.4.1 со спецификацией (фразы, `NOTES.md`) и пауза 429 (память против базы).
Факты, проверенные 2026-10-12, помечены в страницах: `npm test` 365/365, lint 0/0/0, ZIP 0.4.1 — 33 файла и 5 каталогов, первая ручная проверка пользователем; полный маршрут 0.4.1 в Firefox не пройден.
