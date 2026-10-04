# First Firefox Training Loop Implementation Plan

**Goal:** Deliver a runnable Firefox addon with one daily puzzle task, persistent manual completion, a popup, a dashboard and a restorable backup.

**Architecture:** Native JavaScript modules; extension pages send commands to a Firefox background event page. A training service owns changes and uses an IndexedDB transaction to read and write a small training journal. Pure rules derive the current day and weekly progress; no network is needed for this stage.

**Tech Stack:** Firefox desktop 140+, Manifest V3, JavaScript, HTML/CSS, IndexedDB, Node 22+, node:test, fake-indexeddb, web-ext.

**Spec:** `docs/architecture.md`, stage 1. This plan narrows that stage into the following working contract; later stages retain the full architecture.

## Global Constraints

- Firefox first; teaching accompanies the deliverable. No bundler or production dependency.
- Main UI in an extension tab, short popup; Russian interface.
- One local profile: `sebajun777`; program timezone `Asia/Bishkek`.
- Initial task: manually confirm **10 puzzles** each day. This is a starter exercise, not a personalized training recommendation.
- No API, host permissions, content scripts, OAuth, XP or dataset import in this first slice. Dataset source stays untouched; stage 2 imports its 6,429 unique games.
- Keep all training mutations in the background service, persist before reporting success, derive the day in the program timezone.
- Temporarily loaded addons are removed on Firefox restart; permanent installation/signing belongs to stage 6.
- This directory is a new project with no prior Git repository. Initialize a local feature branch for review history; no remote or push.

## Review Focus

- A click after local midnight must not silently complete the newly started day.
- Concurrent popup/dashboard commands must preserve one record per day and the first completion time.
- A malformed, future-version or different-account backup must leave the existing journal unchanged.
- Storage failure must show an error; the UI must not report completion prematurely.
- Reopening a page or recreating the service must restore progress from IndexedDB; no state relies on a long-lived background page.

## Shared contract

`createRepository({ indexedDB = globalThis.indexedDB, name = "lichess-training" } = {})` returns:

- `read(): Promise<State|null>`
- `transact(update): Promise<State>`: `update(currentState|null)` is synchronous and returns the state to store. Resolve only after transaction completion. Throwing inside the callback aborts with no changes. Concurrent transactions serialize.

`createTrainingService({ repository, now = () => new Date() })` returns `handle(command): Promise<object>`.

Commands:

- `{ type: "training.getSnapshot" }` → `Snapshot`
- `{ type: "training.setCompletion", day: "YYYY-MM-DD", completed: boolean }` → `Snapshot`; only the current day can be changed, and retries preserve the initial completion timestamp. Undo sets the timestamp to null.
- `{ type: "training.export" }` → `Backup`
- `{ type: "training.import", backup: Backup }` → `Snapshot`; validated replacement, matching account/timezone/program, no partial writes.

`State`: `{ profile: { username, timeZone }, program: { id: "daily-puzzles", title: "Ежедневная тактика", target: 10, startedOn }, days: [{ date, target, completedAt: ISO-string|null }] }`.

`Snapshot`: `{ profile, program, today: { date, taskId: "puzzles", target, completed, completedAt }, week: [{ date, scheduled, completed }], completedDays }`. Week is today and the previous six dates; dates before program start are not scheduled.

`Backup`: `{ format: "lichess-training-backup", version: 1, exportedAt: ISO-string, state: State }`. Validate real dates, uniqueness, targets 1–500, supported fixed program/profile/timezone, timestamp belongs to its training day, no days before start or after today. Allow at most 10,000 records and 2 MiB JSON. Normalize allowed fields; do not store unknown properties. Backup does not contain account authentication data.

Message transport: background catches service errors and returns `{ ok: true, data }` or `{ ok: false, error: string }`. UI client unwraps into data or throws. Listener synchronously registered; reject messages from outside this extension.

### Task 1: Persisted training rules and service

**Files:** create `extension/core/training-engine.js`, `extension/data/repository.js`, `extension/app/training.js`; tests `tests/training.test.js`, `tests/repository.test.js`; update `package.json`.

**Interfaces:** produce repository and service contracts above; rules export `dayKey(date, timeZone)` and helpers needed by the service. The journal is a single record in IndexedDB v1; separate game stores can be added in stage 2. Network never occurs in a transaction.

- [x] Write behavior tests first: UTC 17:59/18:00 maps to Bishkek's correct date; completion twice has one timestamp; stale day rejects; undo survives service recreation; simultaneous writes serialize; failed transaction leaves prior state; export/restore roundtrip; invalid dates, duplicates, cross-account/timezone, future schema/days and mismatched completion timestamps reject without mutation.
- [x] Run `node --test tests/training.test.js tests/repository.test.js`; observe failures before implementation and record why.
- [x] Implement the pure rules, real IndexedDB repository and service. Use fake-indexeddb only as the unavailable browser storage boundary for tests.
- [x] Run those tests; all pass. Self-review transaction lifetime, import atomicity and clock capture once per command.
- [x] Review the rules, persistence and service before UI integration.

### Task 2: Firefox pages and message integration

**Files:** create `extension/manifest.json`, `extension/background.js`, `extension/ui/client.js`, `extension/ui/popup.html`, `extension/ui/popup.js`, `extension/ui/dashboard.html`, `extension/ui/dashboard.js`, `extension/ui/styles.css`, `extension/icons/training.svg`; focused transport tests `tests/client.test.js` / `tests/background.test.js` if useful.

**Interfaces:** consume `createTrainingService` and the message envelope above. An extension page opens `browser.runtime.getURL("ui/dashboard.html")` via `browser.tabs.create`; no `tabs` permission is required for creating a tab. Export uses a local Blob and download link; import uses a local file input and a review/replace dialog, capped at 2 MiB.

- [x] Write a focused failing transport test covering success, service error and unauthorised sender; avoid tests that merely assert exact copy or element IDs.
- [x] Implement manifest: version `0.1.0`, fixed gecko ID `lichess-training@local`, strict minimum `140.0`, data collection required `["none"]`, action popup, module background scripts; no unused permissions.
- [x] Implement dashboard with today's task, Lichess puzzles link, manual completion/undo, last seven days, completed-day total and export/restore controls. Show loading, persisted success and actionable errors. Use `textContent` for data, external scripts, keyboard labels and visible focus.
- [x] Implement compact popup with today's task/status and dashboard link. Refresh on focus/visibility and at the next timezone day boundary, including dashboard rollover. Pause the completion button during requests and retain the date displayed at click time.
- [x] Run `npm test` and `npm run lint:addon`; zero addon errors/warnings. Review integration; no browser available means visual/Firefox interaction checks remain explicitly manual.

### Task 3: Packaging and learning materials

**Files:** update `README.md`, `docs/architecture.md`, `NOTES.md`; add `docs/manual-qa.md` and `docs/learning/first-working-addon.md`; addon ZIP in `dist/`.

**Interfaces:** uses implemented file paths and package scripts; no fabricated user learning outcomes.

- [x] Document temporary install from `extension/manifest.json`, export/restore exercise, exact module flow and a small independent change to popup's title, distinct from day target changes.
- [x] Document a compact manual QA route: load, mark, reopen, undo, export, inspect preview, restore, two windows, midnight/focus refresh and errors. Record actual automation results separately from pending Firefox checks.
- [x] Run `npm test`, `npm run lint:addon`, `npm run build:addon`; inspect archive file list and all module/HTML references. No source dataset or teaching files are bundled.
- [x] Fresh whole-project review against the stage-1 spec, address material issues, rerun checks after any fixes.
- [x] Report the deliverable, install steps, test evidence, manual verification limit and next dataset stage.

## Completion record

Implemented 4 October 2026. Final independent review: approved, no open findings; 59/59 tests passed. Addon lint reports 0 errors/notices/warnings. ZIP contains 14 product files matching source bytes. Real Firefox installation, rendering and file/dialog checks remain manual as explicitly planned; learner achievements are not claimed. See `docs/verification.md` and `docs/reviews/2026-10-04-stage1.md`.
