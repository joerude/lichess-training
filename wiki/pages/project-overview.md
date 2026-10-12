---
title: Обзор проекта
type: concept
sources: [MISSION.md, docs/architecture.md, NOTES.md, docs/plans/2026-10-12-puzzle-progress-design.md]
updated: 2026-10-12
---

Firefox-расширение для персональных шахматных тренировок на Lichess (ежедневная программа, история, XP, импорт партий, публичный API и автоподсчёт задач) и одновременно учебный проект по разработке расширений.

- Платформа: Firefox, выбрана 4 октября 2026.
- Стек: обычный JavaScript с ES modules, IndexedDB, тесты `node --test`.
- Версия на 2026-10-12: 0.4.1 (автоподсчёт задач поверх этапа 4, ежедневной программы 0.4.0).
- Обучение входит в работу: каждый этап сопровождается уроком в `lessons/` (для 0.4.1 отдельный урок не нужен).

Ежедневная программа 0.4.0: [[plan-stage4-daily-program]], [[stable-reward-ids]], [[practice-transaction]], [[backup-format-v2]], [[practice-rules-tomorrow]].

Автоподсчёт задач 0.4.1: [[plan-0-4-1-puzzle-auto-count]], [[decision-public-puzzle-counter]], [[puzzle-daily-baseline]], [[day-auto-mark-and-suppression]].

Источники: `MISSION.md`, `docs/architecture.md`, `NOTES.md`, `docs/plans/2026-10-12-puzzle-progress-design.md`.
