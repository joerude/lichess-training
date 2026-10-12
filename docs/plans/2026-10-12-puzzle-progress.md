# Автоподсчёт задач и прогресс в popup (0.4.1): план реализации

**Goal:** popup показывает «4 / 10 задач» с полосой и фразой поддержки по публичному счётчику пазлов Lichess и сам засчитывает задание «задачи» при достижении нормы.

**Architecture:** клиент Lichess получает `perfs.puzzle.games` из публичного профиля. Чистый модуль `core/puzzle-progress.js` считает решённые за день Бишкека и решает, ставить ли автоотметку. Сервис `app/puzzles.js` отвечает на сообщение `puzzles.refresh`: делает запрос не чаще раза в минуту и в одной транзакции IndexedDB сохраняет показание `historyMeta['puzzles']`, автоотметку дня и награду. Модуль `ui/puzzle-card.js` рисует прогресс в карточке popup.

**Tech Stack:** Firefox MV3, обычный JavaScript с ES modules, IndexedDB (в тестах `fake-indexeddb`), `node --test` (Node 22), `web-ext lint`.

Спецификация: `docs/plans/2026-10-12-puzzle-progress-design.md`.

## Global Constraints

- Никаких новых зависимостей и сборщиков. Только ES modules, как в остальном `extension/`.
- Профиль `sebajun777`, часовой пояс `Asia/Bishkek`, день меняется в 18:00 UTC. Дни вычисляет только `trainingDay()` из `extension/core/training-engine.js`.
- Запрос: `GET https://lichess.org/api/user/sebajun777`, `Accept: application/json`, `credentials: 'omit'`, `redirect: 'error'`, без `Authorization`. Таймаут 30 с, пауза после 429 не меньше 60 с, тело не больше 1 MiB. Запрос идёт только при разрешении `https://lichess.org/*` (существующий `canAccess`).
- Показание за сегодня переиспользуется 60 000 мс (`PUZZLE_REFRESH_MS`). Фонового опроса нет.
- Схема IndexedDB остаётся версии 2. Новое значение лежит под ключом `'puzzles'` в существующем store `historyMeta`.
- Награда 20 XP со стабильным ID `${startedOn}:${date}:puzzles` начисляется существующим `reconcilePractice`. Повторов нет.
- Новые необязательные поля дня журнала: `source: 'auto'` (ставит только автозачёт; отсутствие поля означает ручную отметку) и `autoSuppressed: true` (любая ручная отмена отметки; ручная повторная отметка поле снимает).
- Тексты интерфейса русские и точно совпадают со спецификацией и этим планом.
- `web-ext lint` должен остаться 0 ошибок, 0 предупреждений, 0 notices. Никакого `innerHTML`, только `textContent`.
- Версия manifest и package: `0.4.1`.
- Не трогать: исходный датасет `~/Desktop/lichess_dataset`, каталог `wiki/`, уроки `lessons/` и памятки `reference/`.
- Коммиты: по одному на задачу, в стиле `feat: …` / `test: …` / `docs: …`.

## Карта файлов

| Файл | Роль |
|---|---|
| `extension/data/lichess-client.js` (изменить) | Общие помощники запроса и новый `fetchPuzzleCount()` |
| `extension/core/training-engine.js` (изменить) | Поля дня `source`/`autoSuppressed`: `setCompletion`, `normalizeBackup`, `snapshotFrom` |
| `extension/core/practice-engine.js` (изменить) | `source: 'auto'` у задания задач |
| `extension/core/puzzle-progress.js` (создать) | Чистые правила: ограничение частоты, точка отсчёта, счёт, автоотметка |
| `extension/data/repository.js` (изменить) | Транзакция программы читает и пишет `historyMeta['puzzles']` |
| `extension/app/practice.js` (изменить) | `recordPuzzleCount(instant, count)` в общей транзакции |
| `extension/app/puzzles.js` (создать) | Сервис `puzzles.refresh` |
| `extension/app/services.js` (изменить) | Маршрут `puzzles.*` |
| `extension/ui/puzzle-card.js` (создать) | Фразы, время, рисование прогресса |
| `extension/ui/popup.html`, `popup.js`, `styles.css`, `page.js`, `practice.js` (изменить) | Разметка, подключение, стили, подписи автоотметки |
| `tests/…` | Тесты каждой задачи |
| `package.json`, `package-lock.json`, `extension/manifest.json`, `docs/manual-qa.md`, `docs/verification.md`, `NOTES.md` | Версия и документы |

---

### Task 1: Клиент Lichess читает счётчик пазлов

**Files:**
- Modify: `extension/data/lichess-client.js` (весь файл)
- Test: `tests/lichess-client.test.js` (дописать в конец)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `createLichessClient(...).fetchPuzzleCount(): Promise<number>`. Возвращает целое ≥ 0 (`perfs.puzzle.games`). Ошибки: у паузы после 429 есть `error.retryAt: number`; при отсутствии или некорректном счётчике `error.code === 'no-data'`; прочие (таймаут, HTTP, сеть) — обычный `Error`. Запрос проходит через ту же очередь и ту же паузу 429, что и `fetchGamesPage`.

- [ ] **Step 1: Write the failing tests**

Дописать в конец `tests/lichess-client.test.js` (помощник `response()` и `interval` уже объявлены в начале файла):

```js
test('reads the public puzzle counter without cookies, token or redirects', async () => {
  let request;
  const client = createLichessClient({ fetchImpl: async (url, options) => {
    request = { url: new URL(url), options };
    return response(['{"id":"sebajun777","perfs":{"puzzle":{"games":894,"rating":1861}}}']);
  } });
  assert.equal(await client.fetchPuzzleCount(), 894);
  assert.equal(request.url.href, 'https://lichess.org/api/user/sebajun777');
  assert.equal(request.options.method, 'GET');
  assert.equal(new Headers(request.options.headers).get('Accept'), 'application/json');
  assert.equal(new Headers(request.options.headers).get('Authorization'), null);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal instanceof AbortSignal);
});

for (const [name, body] of [
  ['missing puzzle perf', '{"perfs":{}}'],
  ['negative counter', '{"perfs":{"puzzle":{"games":-1}}}'],
  ['fractional counter', '{"perfs":{"puzzle":{"games":1.5}}}'],
  ['string counter', '{"perfs":{"puzzle":{"games":"894"}}}'],
  ['invalid JSON', '{"perfs":'],
]) {
  test(`puzzle counter reports no-data for ${name}`, async () => {
    const client = createLichessClient({ fetchImpl: async () => response([body]) });
    await assert.rejects(client.fetchPuzzleCount(), error => error.code === 'no-data');
  });
}

test('puzzle counter shares the 429 pause with game pages', async () => {
  let requests = 0;
  const client = createLichessClient({ now: () => 1000, fetchImpl: async () => {
    requests++;
    return response([], { status: 429, headers: { 'Retry-After': '120' } });
  } });
  await assert.rejects(client.fetchPuzzleCount(), error => error.retryAt === 121000);
  await assert.rejects(client.fetchGamesPage(interval), error => error.retryAt === 121000);
  assert.equal(requests, 1);
});

test('puzzle counter times out and aborts the request', async () => {
  let signal;
  const client = createLichessClient({ timeoutMs: 5, fetchImpl: (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(client.fetchPuzzleCount(), /Истекло время/);
  assert.equal(signal.aborted, true);
});

test('puzzle counter rejects profile bodies above 1 MiB', async () => {
  const client = createLichessClient({ fetchImpl: async () => response([new Uint8Array(1024 * 1024 + 1)]) });
  await assert.rejects(client.fetchPuzzleCount(), /1 MiB/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/lichess-client.test.js`
Expected: FAIL, новые тесты падают с `client.fetchPuzzleCount is not a function`. Старые проходят.

- [ ] **Step 3: Replace `extension/data/lichess-client.js` with the shared-request version**

Поведение `fetchGamesPage` не меняется. Каркас прежнего `requestPage` (пауза 429, таймер, проверка статуса, отмена тела) переезжает в общий `request(url, accept, consume)`, а разбор NDJSON становится его функцией `consume`. Профиль использует тот же каркас, поэтому дублирования нет.

```js
const EXPORT_URL = 'https://lichess.org/api/games/user/sebajun777';
const PROFILE_URL = 'https://lichess.org/api/user/sebajun777';
const MAX_BYTES = 8 * 1024 * 1024;
const PROFILE_MAX_BYTES = 1024 * 1024;
const MAX_DATE = 8640000000000000;

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
}

function cancelBody(body, reason) {
  try {
    Promise.resolve(body?.cancel(reason)).catch(() => {});
  } catch {}
}

function cooldownError(retryAt) {
  const error = new Error('Lichess ограничил частоту запросов. Повторите позже.');
  error.retryAt = retryAt;
  return error;
}

function noDataError() {
  const error = new Error('Профиль Lichess не содержит счётчик задач.');
  error.code = 'no-data';
  return error;
}

function retryTime(header, currentTime) {
  let wait = 60000;
  if (header !== null) {
    const value = header.trim();
    const requested = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - currentTime;
    if (Number.isFinite(requested) && validTimestamp(currentTime + Math.max(wait, requested))) {
      wait = Math.max(wait, requested);
    }
  }
  const retryAt = currentTime + wait;
  if (!validTimestamp(retryAt)) throw new Error('Невозможно определить время следующего запроса.');
  return retryAt;
}

// Rejects after timeoutMs and aborts the request; clear() must run once the request settles.
function createDeadline(controller, timeoutMs) {
  let timer;
  const promise = new Promise((resolve, reject) => {
    function schedule(remaining) {
      const duration = Math.min(remaining, 2147483647);
      timer = setTimeout(() => {
        if (remaining > duration) { schedule(remaining - duration); return; }
        const error = new Error('Истекло время ожидания ответа Lichess.');
        reject(error);
        controller.abort(error);
      }, duration);
    }
    schedule(timeoutMs);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

export function createLichessClient({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 30000 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw new Error('Не заданы функции запроса и времени.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Некорректное время ожидания запроса.');

  let queue = Promise.resolve();
  let retryAt = null;
  function readClock() {
    const currentTime = now();
    if (!validTimestamp(currentTime)) throw new Error('Некорректное текущее время.');
    return currentTime;
  }

  // One GET with the shared 429 pause, timeout and body cleanup; consume(read) drains the stream.
  async function request(url, accept, consume) {
    const currentTime = readClock();
    if (retryAt !== null && currentTime < retryAt) throw cooldownError(retryAt);

    const controller = new AbortController();
    const deadline = createDeadline(controller, timeoutMs);
    let reader;
    let body;
    let complete = false;

    try {
      const fetching = Promise.resolve(fetchImpl(url, {
        method: 'GET', headers: { Accept: accept },
        credentials: 'omit', redirect: 'error', signal: controller.signal,
      })).then(response => {
        if (controller.signal.aborted) cancelBody(response.body, controller.signal.reason);
        return response;
      });
      const response = await Promise.race([fetching, deadline.promise]);
      body = response.body;
      if (!response.ok) {
        if (response.status === 429) {
          retryAt = retryTime(response.headers.get('Retry-After'), readClock());
          throw cooldownError(retryAt);
        }
        throw new Error(`Ошибка запроса к Lichess (HTTP ${response.status}).`);
      }
      if (!body || typeof body.getReader !== 'function') throw new Error('Ответ Lichess не содержит поток данных.');
      reader = body.getReader();
      const result = await consume(() => Promise.race([reader.read(), deadline.promise]));
      complete = true;
      return result;
    } finally {
      deadline.clear();
      if (!complete) cancelBody(reader ?? body, controller.signal.reason);
      if (reader) {
        try { reader.releaseLock(); } catch {}
      }
    }
  }

  // Game pages and the profile share one queue, so a 429 pause covers both.
  function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  function requestPage({ since, until, max }) {
    const url = new URL(EXPORT_URL);
    url.search = new URLSearchParams({
      since, until, max, sort: 'dateAsc', ongoing: 'true', finished: 'true',
      moves: 'true', opening: 'true', clocks: 'false', evals: 'true', accuracy: 'true',
    }).toString();
    return request(url.href, 'application/x-ndjson', async read => {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const records = [];
      let wireBytes = 0;
      let pending = '';
      let lineNumber = 0;
      function parseLine(line) {
        lineNumber++;
        if (!line.trim()) return;
        if (records.length >= max) throw new Error(`Строка ${lineNumber}: превышен лимит партий.`);
        let record;
        try { record = JSON.parse(line); }
        catch { throw new Error(`Строка ${lineNumber}: некорректный JSON.`); }
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error(`Строка ${lineNumber}: ожидается объект партии.`);
        }
        records.push(record);
      }
      for (;;) {
        const { value, done } = await read();
        if (done) { pending += decoder.decode(); break; }
        wireBytes += value.byteLength;
        if (wireBytes > MAX_BYTES) throw new Error('Размер ответа Lichess превышает 8 MiB.');
        pending += decoder.decode(value, { stream: true });
        let start = 0;
        let end;
        while ((end = pending.indexOf('\n', start)) !== -1) {
          parseLine(pending.slice(start, end));
          start = end + 1;
        }
        pending = pending.slice(start);
      }
      if (pending) parseLine(pending);
      return { records, rows: records.length };
    });
  }

  async function requestPuzzleCount() {
    const json = await request(PROFILE_URL, 'application/json', async read => {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      let wireBytes = 0;
      for (;;) {
        const { value, done } = await read();
        if (done) return text + decoder.decode();
        wireBytes += value.byteLength;
        if (wireBytes > PROFILE_MAX_BYTES) throw new Error('Размер профиля Lichess превышает 1 MiB.');
        text += decoder.decode(value, { stream: true });
      }
    });
    let profile;
    try { profile = JSON.parse(json); } catch { throw noDataError(); }
    const games = profile?.perfs?.puzzle?.games;
    if (!Number.isSafeInteger(games) || games < 0) throw noDataError();
    return games;
  }

  return {
    async fetchGamesPage({ since, until, max = 200 } = {}) {
      if (!validTimestamp(since) || !validTimestamp(until) || since >= until) {
        throw new Error('Некорректный диапазон времени партий.');
      }
      if (!Number.isInteger(max) || max < 1 || max > 200) throw new Error('Некорректный лимит партий.');
      return enqueue(() => requestPage({ since, until, max }));
    },
    fetchPuzzleCount() {
      return enqueue(requestPuzzleCount);
    },
  };
}
```

- [ ] **Step 4: Run the client tests**

Run: `node --test tests/lichess-client.test.js`
Expected: PASS, все тесты файла, старые и новые.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 0 падений (312 прежних + новые).

- [ ] **Step 6: Commit**

```bash
git add extension/data/lichess-client.js tests/lichess-client.test.js
git commit -m "feat: read the public Lichess puzzle counter"
```

---

### Task 2: Поля дня `source` и `autoSuppressed`

**Files:**
- Modify: `extension/core/training-engine.js` (`normalizeBackup` строки 79-90, `setCompletion` строки 98-110, `snapshotFrom` строки 123-126)
- Modify: `extension/core/practice-engine.js:143` (`tasksOn`)
- Modify: `extension/ui/practice.js:53`
- Modify: `extension/ui/page.js:85`
- Modify: `tests/training.test.js:47`
- Create: `tests/day-flags.test.js`
- Modify: `tests/practice-ui.test.js` (дописать тест в конец)

**Interfaces:**
- Consumes: ничего нового.
- Produces:
  - День журнала: `{ date, target, completedAt, source?: 'manual' | 'auto', autoSuppressed?: true }`.
  - `setCompletion(state, today, completed, instant)`: при `completed === false` пишет `autoSuppressed: true`; при повторной отметке уже отмеченного дня сохраняет `completedAt` и `source`; при новой ручной отметке `source` не пишет.
  - `snapshotFrom(state, today).today.source`: `'auto' | 'manual' | null` (`null`, если не отмечено).
  - `practiceSnapshot(...).tasks[]` для задач: `source: 'auto'`, если день отмечен автоматически, иначе `'manual'`.

- [ ] **Step 1: Write the failing tests**

Создать `tests/day-flags.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, setCompletion, snapshotFrom, normalizeBackup, backupFrom } from '../extension/core/training-engine.js';
import { reconcilePractice, practiceSnapshot } from '../extension/core/practice-engine.js';

const day = '2026-10-12';
const instant = new Date('2026-10-12T05:00:00Z');
const later = new Date('2026-10-12T06:00:00Z');
const autoDay = state => ({ ...state, days: [{ date: day, target: 10, completedAt: instant.toISOString(), source: 'auto' }] });

test('manual undo suppresses automatic counting for the day and a manual redo clears it', () => {
  const marked = setCompletion(initialState(day), day, true, instant);
  assert.deepEqual(marked.days, [{ date: day, target: 10, completedAt: instant.toISOString() }]);
  const undone = setCompletion(marked, day, false, later);
  assert.deepEqual(undone.days, [{ date: day, target: 10, completedAt: null, autoSuppressed: true }]);
  const redone = setCompletion(undone, day, true, later);
  assert.deepEqual(redone.days, [{ date: day, target: 10, completedAt: later.toISOString() }]);
});

test('repeating a completion keeps the original time and the automatic source', () => {
  const state = autoDay(initialState(day));
  assert.deepEqual(setCompletion(state, day, true, later).days, state.days);
});

test('training snapshot reports who completed today', () => {
  assert.equal(snapshotFrom(initialState(day), day).today.source, null);
  assert.equal(snapshotFrom(setCompletion(initialState(day), day, true, instant), day).today.source, 'manual');
  assert.equal(snapshotFrom(autoDay(initialState(day)), day).today.source, 'auto');
});

test('backups keep source and suppression flags and still accept 0.4.0 days without them', () => {
  const state = { ...initialState('2026-10-10'), days: [
    { date: '2026-10-10', target: 10, completedAt: '2026-10-10T05:00:00.000Z' },
    { date: '2026-10-11', target: 10, completedAt: null, autoSuppressed: true },
    { date: day, target: 10, completedAt: instant.toISOString(), source: 'auto' },
  ] };
  assert.deepEqual(normalizeBackup(backupFrom(state, later), day).days, state.days);
});

for (const [name, change] of [
  ['an unknown source', entry => ({ ...entry, source: 'robot' })],
  ['a source without completion', entry => ({ ...entry, completedAt: null, source: 'auto' })],
  ['a suppression flag that is not true', entry => ({ ...entry, autoSuppressed: false })],
]) {
  test(`backup rejects ${name}`, () => {
    const state = { ...initialState(day), days: [change({ date: day, target: 10, completedAt: instant.toISOString() })] };
    assert.throws(() => normalizeBackup(backupFrom(state, later), day));
  });
}

test('program tasks show automatic puzzle completion', () => {
  const records = reconcilePractice({ journal: autoDay(initialState(day)), practice: null, games: [] }, day, later);
  const puzzles = practiceSnapshot(records, day).tasks.find(task => task.id === 'puzzles');
  assert.deepEqual([puzzles.completed, puzzles.source], [true, 'auto']);
});
```

Дописать в конец `tests/practice-ui.test.js` (`fixture`, `base`, `allText` уже объявлены в файле):

```js
test('automatic puzzle completion is explained on the dashboard', async () => {
  const value = base();
  value.tasks[1] = { ...value.tasks[1], source: 'auto' };
  const { mounted, element } = fixture(async () => value);
  await mounted.refresh();
  assert.match(allText(element('program-tasks')), /Засчитано автоматически по счётчику задач Lichess\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/day-flags.test.js tests/practice-ui.test.js`
Expected: FAIL. Например, `undone.days` не содержит `autoSuppressed`, `today.source` равен `undefined`, нет подписи «Засчитано автоматически».

- [ ] **Step 3: Implement the day fields in `extension/core/training-engine.js`**

3a. Перед `export function normalizeBackup` добавить помощник:

```js
// Optional 0.4.1 fields: who completed the day and whether a manual undo blocks automatic counting.
function dayFlags(entry, completedAt) {
  const flags = {};
  if (entry.source !== undefined) {
    if (completedAt === null || !['manual', 'auto'].includes(entry.source)) throw new Error('Некорректный источник отметки дня.');
    flags.source = entry.source;
  }
  if (entry.autoSuppressed !== undefined) {
    if (entry.autoSuppressed !== true) throw new Error('Некорректный запрет автоподсчёта дня.');
    flags.autoSuppressed = true;
  }
  return flags;
}
```

3b. В `normalizeBackup` заменить строку

```js
    return { date: entry.date, target: requireTarget(entry.target), completedAt };
```

на

```js
    return { date: entry.date, target: requireTarget(entry.target), completedAt, ...dayFlags(entry, completedAt) };
```

3c. Заменить `setCompletion` целиком:

```js
export function setCompletion(state, today, completed, instant) {
  if (today < state.program.startedOn) throw new Error('Тренировочный день предшествует началу программы.');
  const existing = state.days.find(entry => entry.date === today);
  const day = {
    date: today,
    target: existing?.target ?? state.program.target,
    completedAt: completed ? existing?.completedAt ?? instant.toISOString() : null,
  };
  // Keep who completed the day; an undo stops automatic counting from marking it again today.
  if (completed && existing?.completedAt != null && existing.source) day.source = existing.source;
  if (!completed) day.autoSuppressed = true;
  return {
    ...state,
    days: [...state.days.filter(entry => entry.date !== today), day].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
```

3d. В `snapshotFrom` заменить объект `today`:

```js
    today: {
      date: today, taskId: 'puzzles', target: current?.target ?? state.program.target,
      completed: current?.completedAt != null, completedAt: current?.completedAt ?? null,
      source: current?.completedAt != null ? current.source ?? 'manual' : null,
    },
```

- [ ] **Step 4: Show the automatic source in the program task**

В `extension/core/practice-engine.js`, функция `tasksOn`, заменить строку return:

```js
    return { id, target: targets[id], current, completed: current >= targets[id],
      source: id === 'puzzles' ? (day?.completedAt != null && day.source === 'auto' ? 'auto' : 'manual') : id === 'reviews' ? 'review' : 'games' };
```

В `extension/ui/practice.js` после строки 53 (`if (task.source === 'manual') …`) добавить:

```js
      if (task.source === 'auto') card.append(node('p', 'Засчитано автоматически по счётчику задач Lichess.', 'caption'));
```

В `extension/ui/page.js:85` заменить строку статуса:

```js
      document.getElementById('today-status').textContent = value.today.completed
        ? (value.today.source === 'auto' ? '✓ Засчитано по счётчику Lichess' : '✓ Тренировка выполнена')
        : '○ Сегодня ещё не отмечено';
```

- [ ] **Step 5: Update the snapshot expectation in `tests/training.test.js:47`**

```js
  assert.deepEqual(result.today, { date: '2026-10-04', taskId: 'puzzles', target: 10, completed: false, completedAt: null, source: null });
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. Если упал другой тест, который сравнивает день после ручной отмены через `deepEqual` без `autoSuppressed`, добавьте в его ожидание `autoSuppressed: true` и упомяните это в отчёте. Любое другое падение — остановиться и сообщить.

- [ ] **Step 7: Commit**

```bash
git add extension/core/training-engine.js extension/core/practice-engine.js extension/ui/practice.js extension/ui/page.js tests/day-flags.test.js tests/training.test.js tests/practice-ui.test.js
git commit -m "feat: record automatic puzzle marks and manual undo per day"
```

---

### Task 3: Чистые правила подсчёта `core/puzzle-progress.js`

**Files:**
- Create: `extension/core/puzzle-progress.js`
- Test: `tests/puzzle-progress.test.js`

**Interfaces:**
- Consumes: `setCompletion(state, today, completed, instant)` из Task 2 (не пишет `source` при новой отметке).
- Produces:
  - `PUZZLE_REFRESH_MS = 60000`
  - `shouldFetchPuzzles(record, instant: Date, today: string): boolean`
  - `observePuzzleCount(record, count: number, instant: Date, today: string): PuzzleRecord`, где `PuzzleRecord = { date, baseline, latest, baselineAt, observedAt }` (время в ISO).
  - `solvedToday(record, today): number | null` (`null`, если показания за сегодня нет).
  - `applyAutoCompletion(journal, today, solved: number | null, instant: Date)`: возвращает **тот же объект** `journal`, если ничего не меняется, иначе новый журнал с днём `{ …, completedAt, source: 'auto' }`.

- [ ] **Step 1: Write the failing tests**

Создать `tests/puzzle-progress.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, setCompletion } from '../extension/core/training-engine.js';
import { PUZZLE_REFRESH_MS, shouldFetchPuzzles, observePuzzleCount, solvedToday, applyAutoCompletion } from '../extension/core/puzzle-progress.js';

const day = '2026-10-12';
// Bishkek is UTC+6: 03:14Z is 09:14 local time on 12 October.
const at = time => new Date(`${day}T${time}Z`);

test('the first reading of the day becomes the baseline', () => {
  const record = observePuzzleCount(null, 894, at('03:14:00'), day);
  assert.deepEqual(record, { date: day, baseline: 894, latest: 894,
    baselineAt: '2026-10-12T03:14:00.000Z', observedAt: '2026-10-12T03:14:00.000Z' });
  assert.equal(solvedToday(record, day), 0);
});

test('later readings on the same day count from the baseline', () => {
  const first = observePuzzleCount(null, 894, at('03:14:00'), day);
  const second = observePuzzleCount(first, 898, at('04:02:00'), day);
  assert.equal(second.baselineAt, first.baselineAt);
  assert.equal(second.observedAt, '2026-10-12T04:02:00.000Z');
  assert.equal(solvedToday(second, day), 4);
});

test('a new Bishkek day starts a new baseline', () => {
  const yesterday = observePuzzleCount(null, 880, new Date('2026-10-11T15:00:00Z'), '2026-10-11');
  const today = observePuzzleCount(yesterday, 894, at('03:14:00'), day);
  assert.deepEqual([today.date, today.baseline, solvedToday(today, day)], [day, 894, 0]);
  assert.equal(solvedToday(yesterday, day), null);
});

test('a lower counter restarts the count instead of going negative', () => {
  const first = observePuzzleCount(null, 894, at('03:14:00'), day);
  const lower = observePuzzleCount(first, 890, at('04:00:00'), day);
  assert.deepEqual([lower.baseline, lower.latest, solvedToday(lower, day)], [890, 890, 0]);
});

test('invalid counters are rejected and broken records are ignored', () => {
  for (const count of [-1, 1.5, '894', null, NaN]) {
    assert.throws(() => observePuzzleCount(null, count, at('03:14:00'), day));
  }
  assert.equal(solvedToday({ date: day, baseline: 5, latest: 2 }, day), null);
  assert.equal(shouldFetchPuzzles({ date: day }, at('03:14:00'), day), true);
});

test('a reading for today is reused for one minute', () => {
  const record = observePuzzleCount(null, 894, at('03:14:00'), day);
  const observed = Date.parse(record.observedAt);
  assert.equal(shouldFetchPuzzles(null, at('03:14:00'), day), true);
  assert.equal(shouldFetchPuzzles(record, new Date(observed + PUZZLE_REFRESH_MS - 1), day), false);
  assert.equal(shouldFetchPuzzles(record, new Date(observed + PUZZLE_REFRESH_MS), day), true);
  assert.equal(shouldFetchPuzzles(record, at('03:13:00'), day), true, 'a clock moved backwards asks again');
  const lateYesterday = observePuzzleCount(null, 894, new Date('2026-10-11T17:59:30Z'), '2026-10-11');
  assert.equal(shouldFetchPuzzles(lateYesterday, new Date('2026-10-11T18:00:10Z'), day), true, 'midnight needs a new baseline');
});

test('reaching the target marks the day automatically once', () => {
  const journal = initialState(day);
  assert.equal(applyAutoCompletion(journal, day, 9, at('04:00:00')), journal);
  const marked = applyAutoCompletion(journal, day, 10, at('04:00:00'));
  assert.deepEqual(marked.days, [{ date: day, target: 10, completedAt: '2026-10-12T04:00:00.000Z', source: 'auto' }]);
  assert.equal(applyAutoCompletion(marked, day, 12, at('05:00:00')), marked);
});

test('unknown counts, manual marks and a manual undo are left alone', () => {
  const journal = initialState(day);
  assert.equal(applyAutoCompletion(journal, day, null, at('04:00:00')), journal);
  const manual = setCompletion(journal, day, true, at('03:00:00'));
  assert.equal(applyAutoCompletion(manual, day, 10, at('04:00:00')), manual);
  const undone = setCompletion(manual, day, false, at('03:30:00'));
  assert.equal(applyAutoCompletion(undone, day, 15, at('04:00:00')), undone);
});

test('the day target overrides the program target', () => {
  const journal = { ...initialState(day), days: [{ date: day, target: 3, completedAt: null }] };
  assert.equal(applyAutoCompletion(journal, day, 3, at('04:00:00')).days[0].source, 'auto');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/puzzle-progress.test.js`
Expected: FAIL, `Cannot find module '…/extension/core/puzzle-progress.js'`.

- [ ] **Step 3: Create `extension/core/puzzle-progress.js`**

```js
import { setCompletion } from './training-engine.js';

export const PUZZLE_REFRESH_MS = 60000;

function usable(record) {
  return Boolean(record) && typeof record === 'object' && typeof record.date === 'string' &&
    Number.isSafeInteger(record.baseline) && Number.isSafeInteger(record.latest) &&
    record.baseline >= 0 && record.latest >= record.baseline &&
    typeof record.baselineAt === 'string' && Number.isFinite(Date.parse(record.observedAt));
}

// A reading for today that is younger than a minute is reused instead of asking Lichess again.
export function shouldFetchPuzzles(record, instant, today) {
  if (!usable(record) || record.date !== today) return true;
  const elapsed = instant.getTime() - Date.parse(record.observedAt);
  return elapsed < 0 || elapsed >= PUZZLE_REFRESH_MS;
}

// The first reading of a Bishkek day becomes its baseline; a lower counter restarts the count.
export function observePuzzleCount(record, count, instant, today) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Некорректный счётчик задач Lichess.');
  const at = instant.toISOString();
  if (!usable(record) || record.date !== today || count < record.baseline) {
    return { date: today, baseline: count, latest: count, baselineAt: at, observedAt: at };
  }
  return { ...record, latest: count, observedAt: at };
}

export function solvedToday(record, today) {
  return usable(record) && record.date === today ? record.latest - record.baseline : null;
}

// Returns the same journal object when nothing changes, so callers can detect a new mark.
export function applyAutoCompletion(journal, today, solved, instant) {
  if (solved === null) return journal;
  const day = journal.days.find(entry => entry.date === today);
  if (day?.completedAt != null || day?.autoSuppressed === true) return journal;
  if (solved < (day?.target ?? journal.program.target)) return journal;
  const completed = setCompletion(journal, today, true, instant);
  return { ...completed, days: completed.days.map(entry => entry.date === today ? { ...entry, source: 'auto' } : entry) };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/puzzle-progress.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add extension/core/puzzle-progress.js tests/puzzle-progress.test.js
git commit -m "feat: count today's puzzles from a daily baseline"
```

---

### Task 4: Показание в транзакции программы

**Files:**
- Modify: `extension/data/repository.js:133-168` (`practiceTransaction`)
- Modify: `extension/app/practice.js` (import, `update`, новый `recordPuzzleCount`, return)
- Modify: `tests/practice-repository.test.js:8`, добавить тест в конец
- Modify: `tests/practice-service.test.js` (import и два теста в конец)

**Interfaces:**
- Consumes: `observePuzzleCount`, `solvedToday`, `applyAutoCompletion` (Task 3).
- Produces:
  - `repository.readPractice()` / `transactPractice()` дают `{ journal, practice, games, sync, puzzles }`, где `puzzles` — значение `historyMeta['puzzles']` или `null`.
  - Если updater вернул `puzzles`, отличный по ссылке от прочитанного и не `null`/`undefined`, он записывается в `historyMeta['puzzles']`. Тот же объект или его отсутствие запись не трогает. Не объект — транзакция отменяется.
  - `createPracticeService(...).recordPuzzleCount(instant: Date, count: number | null): Promise<{ records, autoCompleted: boolean }>`. При `count === null` используется сохранённое показание. `records` содержит `journal`, `practice`, `puzzles`.

- [ ] **Step 1: Write the failing tests**

В `tests/practice-repository.test.js:8` заменить ожидание:

```js
  assert.deepEqual(await repository.readPractice(), { journal: null, practice: null, games: [], sync: null, puzzles: null });
```

Дописать в конец `tests/practice-repository.test.js`:

```js
test('a practice transaction writes a new puzzle reading and keeps the stored one otherwise', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const reading = { date: '2026-10-12', baseline: 894, latest: 894,
    baselineAt: '2026-10-12T03:14:00.000Z', observedAt: '2026-10-12T03:14:00.000Z' };
  await repository.transactPractice(() => ({ journal: { value: 1 }, practice: { value: 2 }, puzzles: reading }));
  assert.deepEqual((await repository.readPractice()).puzzles, reading);
  await repository.transactPractice(current => ({ ...current, journal: { value: 3 }, practice: { value: 4 } }));
  assert.deepEqual((await repository.readPractice()).puzzles, reading);
  await assert.rejects(repository.transactPractice(() => ({ journal: { value: 5 }, practice: { value: 6 }, puzzles: [] })));
  const stored = await repository.readPractice();
  assert.deepEqual([stored.journal.value, stored.puzzles], [3, reading]);
});
```

В `tests/practice-service.test.js` добавить импорт после строки 5:

```js
import { createPracticeService } from '../extension/app/practice.js';
```

и дописать в конец файла:

```js
test('recording puzzle readings marks the day once with one 20 XP reward', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const practice = createPracticeService({ repository });
  const first = await practice.recordPuzzleCount(new Date('2026-10-12T03:14:00Z'), 894);
  assert.equal(first.autoCompleted, false);
  assert.equal(first.records.puzzles.baseline, 894);
  const second = await practice.recordPuzzleCount(new Date('2026-10-12T04:00:00Z'), 904);
  assert.equal(second.autoCompleted, true);
  const today = second.records.journal.days.find(entry => entry.date === '2026-10-12');
  assert.deepEqual([today.source, today.completedAt], ['auto', '2026-10-12T04:00:00.000Z']);
  const third = await practice.recordPuzzleCount(new Date('2026-10-12T05:00:00Z'), 910);
  assert.equal(third.autoCompleted, false);
  const rewards = third.records.practice.rewards.filter(reward => reward.taskId === 'puzzles');
  assert.deepEqual(rewards.map(reward => reward.points), [20]);
});

test('a null reading reuses the stored counter and a manual undo is respected', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const time = new Date('2026-10-12T04:00:00Z');
  const services = createServices({ repository, now: () => time, lichess: {} });
  const practice = createPracticeService({ repository });
  await practice.recordPuzzleCount(new Date('2026-10-12T03:00:00Z'), 894);
  await practice.recordPuzzleCount(time, 904);
  await services.handle({ type: 'training.setCompletion', day: '2026-10-12', completed: false });
  const again = await practice.recordPuzzleCount(time, null);
  assert.equal(again.autoCompleted, false);
  assert.equal(again.records.puzzles.latest, 904);
  assert.equal(again.records.journal.days[0].completedAt, null);
  assert.equal(again.records.practice.rewards.some(reward => reward.taskId === 'puzzles'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/practice-repository.test.js tests/practice-service.test.js`
Expected: FAIL: в результате `readPractice()` нет ключа `puzzles`; `practice.recordPuzzleCount is not a function`.

- [ ] **Step 3: Read and write the reading in `extension/data/repository.js`**

В `practiceTransaction` заменить блок от `let result = …` до конца обработчика `request.onsuccess` на:

```js
      let result = { journal: null, practice: null, games: [], sync: null, puzzles: null };
      let remaining = 5;
      let failure;
      for (const [key, request] of [
        ['journal', journal.get(stateKey)], ['practice', journal.get('practice')],
        ['games', transaction.objectStore('games').getAll()],
        ['sync', transaction.objectStore('historyMeta').get('sync')],
        ['puzzles', transaction.objectStore('historyMeta').get('puzzles')],
      ]) {
        request.onsuccess = () => {
          result[key] = request.result ?? (key === 'games' ? [] : null);
          if (--remaining !== 0 || !update) return;
          try {
            const records = update(result);
            if (records && typeof records.then === 'function') throw new Error('The practice updater must be synchronous.');
            for (const name of ['journal', 'practice']) {
              if (!records?.[name] || typeof records[name] !== 'object' || Array.isArray(records[name])) {
                throw new Error('Некорректные записи программы.');
              }
            }
            const saved = structuredClone({ journal: records.journal, practice: records.practice });
            journal.put(saved.journal, stateKey);
            journal.put(saved.practice, 'practice');
            // Only a new counter reading is written; passing the read record through leaves it untouched.
            if (records.puzzles != null && records.puzzles !== result.puzzles) {
              if (typeof records.puzzles !== 'object' || Array.isArray(records.puzzles)) throw new Error('Некорректная запись счётчика задач.');
              saved.puzzles = structuredClone(records.puzzles);
              transaction.objectStore('historyMeta').put(saved.puzzles, 'puzzles');
            }
            result = { ...result, ...saved };
          } catch (error) { failure = error; transaction.abort(); }
        };
      }
```

Строки `transaction.oncomplete/onabort/onerror` после цикла не меняются.

- [ ] **Step 4: Add `recordPuzzleCount` to `extension/app/practice.js`**

4a. Добавить импорт после строки 4:

```js
import { observePuzzleCount, solvedToday, applyAutoCompletion } from '../core/puzzle-progress.js';
```

4b. Заменить `update` (в итоговой записи остаются прочитанные факты, чтобы показание счётчика доходило до репозитория):

```js
  async function update(instant, apply = records => records) {
    const today = trainingDay(instant);
    return repository.transactPractice(records => {
      const prepared = { ...records, ...reconcilePractice(records, today, instant) };
      // Keep the read facts (games, sync, puzzle counter) next to the reconciled records.
      const applied = { ...prepared, ...apply(prepared, today) };
      return { ...applied, ...reconcilePractice(applied, today, instant) };
    });
  }
```

4c. Перед строкой `return { handle, handleTraining };` добавить функцию и заменить return:

```js
  // Saves a counter reading (null keeps the stored one) and marks the day once the target is reached.
  async function recordPuzzleCount(instant, count) {
    let autoCompleted = false;
    const records = await update(instant, (current, today) => {
      const puzzles = count === null ? current.puzzles : observePuzzleCount(current.puzzles, count, instant, today);
      const journal = applyAutoCompletion(current.journal, today, solvedToday(puzzles, today), instant);
      autoCompleted = journal !== current.journal;
      return { ...current, puzzles, journal };
    });
    return { records, autoCompleted };
  }

  return { handle, handleTraining, recordPuzzleCount };
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/practice-repository.test.js tests/practice-service.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add extension/data/repository.js extension/app/practice.js tests/practice-repository.test.js tests/practice-service.test.js
git commit -m "feat: store puzzle readings with the practice transaction"
```

---

### Task 5: Сервис `puzzles.refresh` и маршрут

**Files:**
- Create: `extension/app/puzzles.js`
- Modify: `extension/app/services.js`
- Test: `tests/puzzle-service.test.js`

**Interfaces:**
- Consumes: `lichess.fetchPuzzleCount()` (Task 1); `shouldFetchPuzzles`, `solvedToday` (Task 3); `practice.recordPuzzleCount` и `repository.readPractice().puzzles` (Task 4); `snapshotFrom(...).today.source` (Task 2).
- Produces: сообщение `{ type: 'puzzles.refresh' }` → `PuzzleView`:

```js
{ status: 'ok' | 'no-permission' | 'offline' | 'rate-limited' | 'no-data',
  date: 'YYYY-MM-DD', solved: number | null, target: number,
  completed: boolean, source: 'auto' | 'manual' | null,
  baselineAt: string | null, observedAt: string | null, autoCompleted: boolean }
```

Одновременные вызовы делят один запрос. Неизвестная команда `puzzles.*` отклоняется с текстом «Неизвестная команда счётчика задач.».

- [ ] **Step 1: Write the failing tests**

Создать `tests/puzzle-service.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createServices } from '../extension/app/services.js';

function fixture({ access = true, counts = [] } = {}) {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  let time = new Date('2026-10-12T03:14:00Z');
  let requests = 0;
  const lichess = {
    fetchGamesPage: async () => assert.fail('puzzle refresh must not request games'),
    async fetchPuzzleCount() {
      requests += 1;
      const next = counts.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const service = createServices({ repository, now: () => time, lichess, canAccess: async () => access });
  return { repository, service, requests: () => requests, at: value => { time = new Date(value); } };
}
const refresh = service => service.handle({ type: 'puzzles.refresh' });

test('the first refresh sets the baseline and later readings show progress', async () => {
  const f = fixture({ counts: [894, 898] });
  const first = await refresh(f.service);
  assert.deepEqual([first.status, first.date, first.solved, first.target, first.completed], ['ok', '2026-10-12', 0, 10, false]);
  assert.equal(first.baselineAt, '2026-10-12T03:14:00.000Z');
  f.at('2026-10-12T04:02:00Z');
  const second = await refresh(f.service);
  assert.deepEqual([second.solved, second.observedAt, f.requests()], [4, '2026-10-12T04:02:00.000Z', 2]);
});

test('refreshes within a minute reuse the stored reading', async () => {
  const f = fixture({ counts: [894] });
  await refresh(f.service);
  f.at('2026-10-12T03:14:59Z');
  assert.equal((await refresh(f.service)).solved, 0);
  assert.equal(f.requests(), 1);
});

test('reaching the target marks the task automatically with one reward', async () => {
  const f = fixture({ counts: [894, 904, 906] });
  await refresh(f.service);
  f.at('2026-10-12T04:00:00Z');
  const done = await refresh(f.service);
  assert.deepEqual([done.solved, done.completed, done.source, done.autoCompleted], [10, true, 'auto', true]);
  f.at('2026-10-12T04:05:00Z');
  const again = await refresh(f.service);
  assert.deepEqual([again.solved, again.autoCompleted], [12, false]);
  const program = await f.service.handle({ type: 'program.getSnapshot' });
  assert.equal(program.tasks.find(task => task.id === 'puzzles').source, 'auto');
  assert.equal(program.rewards.totalXp, 20);
});

test('a manual undo is not overridden by later readings', async () => {
  const f = fixture({ counts: [894, 904, 907] });
  await refresh(f.service);
  f.at('2026-10-12T04:00:00Z');
  await refresh(f.service);
  await f.service.handle({ type: 'training.setCompletion', day: '2026-10-12', completed: false });
  f.at('2026-10-12T04:05:00Z');
  const after = await refresh(f.service);
  assert.deepEqual([after.solved, after.completed], [13, false]);
  assert.equal((await f.service.handle({ type: 'program.getSnapshot' })).rewards.totalXp, 0);
});

test('without permission no request is made and the manual mode stays', async () => {
  const f = fixture({ access: false, counts: [894] });
  const result = await refresh(f.service);
  assert.deepEqual([result.status, result.solved, result.baselineAt, f.requests()], ['no-permission', null, null, 0]);
});

test('network failures keep the last reading for today and name the reason', async () => {
  const pause = Object.assign(new Error('pause'), { retryAt: Date.parse('2026-10-12T05:00:00Z') });
  const missing = Object.assign(new Error('missing'), { code: 'no-data' });
  const f = fixture({ counts: [894, new Error('offline'), pause, missing] });
  await refresh(f.service);
  for (const [time, status] of [['2026-10-12T04:00:00Z', 'offline'], ['2026-10-12T04:02:00Z', 'rate-limited'], ['2026-10-12T04:04:00Z', 'no-data']]) {
    f.at(time);
    const result = await refresh(f.service);
    assert.deepEqual([result.status, result.solved, result.observedAt], [status, 0, '2026-10-12T03:14:00.000Z']);
  }
});

test('the first reading after midnight starts a new count', async () => {
  const f = fixture({ counts: [894, 904] });
  f.at('2026-10-11T17:59:30Z');
  await refresh(f.service);
  f.at('2026-10-11T18:00:10Z');
  const next = await refresh(f.service);
  assert.deepEqual([next.date, next.solved, f.requests()], ['2026-10-12', 0, 2]);
});

test('concurrent refreshes share one request', async () => {
  const f = fixture({ counts: [894] });
  const [a, b] = await Promise.all([refresh(f.service), refresh(f.service)]);
  assert.deepEqual([a.solved, b.solved, f.requests()], [0, 0, 1]);
});

test('unknown puzzle commands are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.service.handle({ type: 'puzzles.unknown' }), /Неизвестная команда счётчика задач/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/puzzle-service.test.js`
Expected: FAIL. Команда `puzzles.refresh` уходит в сервис тренировки и отклоняется как «Неизвестная команда.».

- [ ] **Step 3: Create `extension/app/puzzles.js`**

```js
import { trainingDay, snapshotFrom } from '../core/training-engine.js';
import { shouldFetchPuzzles, solvedToday } from '../core/puzzle-progress.js';

function failureStatus(error) {
  if (Number.isSafeInteger(error?.retryAt)) return 'rate-limited';
  return error?.code === 'no-data' ? 'no-data' : 'offline';
}

export function createPuzzleService({ repository, practice, lichess, canAccess = async () => false, now = () => new Date() }) {
  let active = null;

  function readClock() {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Некорректное время обновления.');
    return new Date(value.getTime());
  }

  async function refresh() {
    const checkedAt = readClock();
    const stored = (await repository.readPractice()).puzzles;
    let status = 'ok';
    let count = null;
    if (!await canAccess()) status = 'no-permission';
    else if (shouldFetchPuzzles(stored, checkedAt, trainingDay(checkedAt))) {
      try { count = await lichess.fetchPuzzleCount(); }
      catch (error) { status = failureStatus(error); }
    }
    // Record with the time after the request, so a reading taken after midnight starts the new day.
    const instant = readClock();
    const today = trainingDay(instant);
    const { records, autoCompleted } = await practice.recordPuzzleCount(instant, count);
    const day = snapshotFrom(records.journal, today).today;
    const solved = solvedToday(records.puzzles, today);
    return { status, date: today, solved, target: day.target, completed: day.completed, source: day.source,
      baselineAt: solved === null ? null : records.puzzles.baselineAt,
      observedAt: solved === null ? null : records.puzzles.observedAt, autoCompleted };
  }

  return {
    async handle(command) {
      if (command?.type !== 'puzzles.refresh') throw new Error('Неизвестная команда счётчика задач.');
      if (active) return active;
      active = refresh().finally(() => { active = null; });
      return active;
    },
  };
}
```

- [ ] **Step 4: Route `puzzles.*` in `extension/app/services.js`**

Заменить файл целиком:

```js
import { createTrainingService } from './training.js';
import { createHistoryService } from './history.js';
import { createSyncService } from './sync.js';
import { createPracticeService } from './practice.js';
import { createPuzzleService } from './puzzles.js';
import { createLichessClient } from '../data/lichess-client.js';

export function createServices({ repository, now, lichess = createLichessClient(), canAccess }) {
  const practice = createPracticeService({ repository, now });
  const training = createTrainingService({ repository, practice, now });
  const history = createHistoryService({ repository, now });
  const sync = createSyncService({ repository, now, lichess, canAccess });
  const puzzles = createPuzzleService({ repository, practice, lichess, canAccess, now });
  return {
    handle(command) {
      if (!command || typeof command !== 'object') throw new Error('Некорректная команда.');
      if (typeof command.type === 'string' && command.type.startsWith('history.')) return history.handle(command);
      if (typeof command.type === 'string' && command.type.startsWith('sync.')) return sync.handle(command);
      if (typeof command.type === 'string' && command.type.startsWith('program.')) return practice.handle(command);
      if (typeof command.type === 'string' && command.type.startsWith('puzzles.')) return puzzles.handle(command);
      return training.handle(command);
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/puzzle-service.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add extension/app/puzzles.js extension/app/services.js tests/puzzle-service.test.js
git commit -m "feat: refresh puzzle progress through a throttled background service"
```

---

### Task 6: Прогресс в карточке popup

**Files:**
- Create: `extension/ui/puzzle-card.js`
- Modify: `extension/ui/popup.html:16-17`
- Modify: `extension/ui/popup.js`
- Modify: `extension/ui/styles.css` (после строки 114, `.popup-card .button-secondary …`)
- Test: `tests/puzzle-card.test.js`

**Interfaces:**
- Consumes: сообщение `puzzles.refresh` → `PuzzleView` (Task 5); `puzzleNoun(count)` из `extension/ui/page.js`; из `mountTrainingPage()` — `page.client`, `page.controller.refresh()`; из `mountPractice()` — `practice.refresh()`.
- Produces:
  - `puzzlePhrase({ solved, target, status }): string`
  - `formatClock(iso: string): string` — «ЧЧ:ММ» по Asia/Bishkek
  - `mountPuzzleCard({ client, document?, onAutoComplete?, onError? }) → { refresh(): Promise<PuzzleView | null> }`. Использует элементы `#puzzle-progress`, `#puzzle-solved`, `#puzzle-bar`, `#puzzle-phrase`, `#puzzle-meta`. Сетевые сбои приходят как `status`. Отклонённый запрос (сбой хранилища, неверное время) показывает ручной режим и передаётся в `onError(error)`; popup выводит его через `page.showError`.

- [ ] **Step 1: Write the failing tests**

Создать `tests/puzzle-card.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { puzzlePhrase, formatClock, mountPuzzleCard } from '../extension/ui/puzzle-card.js';

function fixture(request) {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { id, textContent: '', hidden: true, max: 1, value: 0 });
    return nodes.get(id);
  } };
  let autoCompletes = 0;
  const errors = [];
  const card = mountPuzzleCard({ client: { request }, document,
    onAutoComplete: () => { autoCompletes += 1; }, onError: error => { errors.push(error.message); } });
  return { card, node: id => document.getElementById(id), autoCompletes: () => autoCompletes, errors };
}
const reading = (changes = {}) => ({ status: 'ok', date: '2026-10-12', solved: 4, target: 10, completed: false, source: null,
  baselineAt: '2026-10-12T03:14:00.000Z', observedAt: '2026-10-12T04:02:00.000Z', autoCompleted: false, ...changes });

test('phrases follow progress for targets 1, 10 and 11', () => {
  const phrase = (solved, target = 10, status = 'ok') => puzzlePhrase({ solved, target, status });
  assert.equal(phrase(0), 'Начнём — 10 задач на сегодня');
  assert.equal(phrase(1), 'Хорошее начало — осталось 9');
  assert.equal(phrase(4), 'Хорошее начало — осталось 6');
  assert.equal(phrase(5), 'Так держать — осталось 5');
  assert.equal(phrase(9), 'Так держать — осталось 1');
  assert.equal(phrase(10), 'Норма выполнена! +20 XP');
  assert.equal(phrase(13), 'Сверх нормы: 13 задач');
  assert.equal(phrase(0, 1), 'Начнём — 1 задача на сегодня');
  assert.equal(phrase(1, 1), 'Норма выполнена! +20 XP');
  assert.equal(phrase(5, 11), 'Хорошее начало — осталось 6');
  assert.equal(phrase(6, 11), 'Так держать — осталось 5');
  assert.equal(phrase(null, 10, 'no-permission'), 'Автоподсчёт выключен: подключите Lichess на основном экране');
  for (const status of ['offline', 'rate-limited', 'no-data']) {
    assert.equal(phrase(null, 10, status), 'Нет данных Lichess — можно отметить вручную');
  }
});

test('clock times are shown in Bishkek time', () => {
  assert.equal(formatClock('2026-10-12T03:14:00.000Z'), '09:14');
});

test('the card shows 4 / 10 with a bar, phrase and times', async () => {
  const commands = [];
  const f = fixture(async command => { commands.push(command); return reading(); });
  await f.card.refresh();
  assert.deepEqual(commands, [{ type: 'puzzles.refresh' }]);
  assert.deepEqual([f.node('puzzle-solved').textContent, f.node('puzzle-solved').hidden], ['4 / ', false]);
  assert.deepEqual([f.node('puzzle-bar').max, f.node('puzzle-bar').value, f.node('puzzle-bar').hidden], [10, 4, false]);
  assert.equal(f.node('puzzle-phrase').textContent, 'Хорошее начало — осталось 6');
  assert.deepEqual([f.node('puzzle-meta').textContent, f.node('puzzle-meta').hidden], ['счёт с 09:14 · обновлено 10:02', false]);
  assert.equal(f.node('puzzle-progress').hidden, false);
});

test('the bar stops at the target and an automatic mark refreshes the rest of the popup', async () => {
  const f = fixture(async () => reading({ solved: 12, completed: true, source: 'auto', autoCompleted: true }));
  await f.card.refresh();
  assert.equal(f.node('puzzle-bar').value, 10);
  assert.equal(f.node('puzzle-phrase').textContent, 'Сверх нормы: 12 задач');
  assert.equal(f.autoCompletes(), 1);
});

test('without a reading the card hides numbers and explains the manual mode', async () => {
  const f = fixture(async () => reading({ status: 'no-permission', solved: null, baselineAt: null, observedAt: null }));
  await f.card.refresh();
  assert.deepEqual([f.node('puzzle-solved').hidden, f.node('puzzle-bar').hidden, f.node('puzzle-meta').hidden], [true, true, true]);
  assert.equal(f.node('puzzle-phrase').textContent, 'Автоподсчёт выключен: подключите Lichess на основном экране');
  assert.equal(f.node('puzzle-progress').hidden, false);
});

test('stale readings are marked and request failures are reported while the manual mode stays', async () => {
  const stale = fixture(async () => reading({ status: 'offline' }));
  await stale.card.refresh();
  assert.equal(stale.node('puzzle-meta').textContent, 'счёт с 09:14 · обновлено 10:02 · данные могли устареть');
  assert.deepEqual(stale.errors, []);
  const failing = fixture(async () => { throw new Error('Disk full'); });
  assert.equal(await failing.card.refresh(), null);
  assert.equal(failing.node('puzzle-phrase').textContent, 'Нет данных Lichess — можно отметить вручную');
  assert.deepEqual(failing.errors, ['Disk full']);
});

test('overlapping refreshes send one request', async () => {
  let requests = 0;
  const f = fixture(async () => { requests += 1; return reading(); });
  await Promise.all([f.card.refresh(), f.card.refresh()]);
  assert.equal(requests, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/puzzle-card.test.js`
Expected: FAIL, `Cannot find module '…/extension/ui/puzzle-card.js'`.

- [ ] **Step 3: Create `extension/ui/puzzle-card.js`**

```js
import { puzzleNoun } from './page.js';

const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });

export function formatClock(iso) {
  return clock.format(new Date(iso));
}

export function puzzlePhrase({ solved, target, status }) {
  if (solved === null) {
    return status === 'no-permission'
      ? 'Автоподсчёт выключен: подключите Lichess на основном экране'
      : 'Нет данных Lichess — можно отметить вручную';
  }
  if (solved === 0) return `Начнём — ${target} ${puzzleNoun(target)} на сегодня`;
  if (solved > target) return `Сверх нормы: ${solved} ${puzzleNoun(solved)}`;
  if (solved === target) return 'Норма выполнена! +20 XP';
  return `${solved < Math.ceil(target / 2) ? 'Хорошее начало' : 'Так держать'} — осталось ${target - solved}`;
}

export function mountPuzzleCard({ client, document = globalThis.document, onAutoComplete = () => {}, onError = () => {} }) {
  const box = document.getElementById('puzzle-progress');
  const solvedNode = document.getElementById('puzzle-solved');
  const bar = document.getElementById('puzzle-bar');
  const phrase = document.getElementById('puzzle-phrase');
  const meta = document.getElementById('puzzle-meta');
  let pending = null;

  function render(value) {
    const known = value.solved !== null;
    solvedNode.hidden = !known;
    solvedNode.textContent = known ? `${value.solved} / ` : '';
    bar.hidden = !known;
    if (known) {
      bar.max = value.target;
      bar.value = Math.min(value.solved, value.target);
    }
    phrase.textContent = puzzlePhrase(value);
    meta.hidden = !known;
    meta.textContent = known
      ? `счёт с ${formatClock(value.baselineAt)} · обновлено ${formatClock(value.observedAt)}${value.status === 'ok' ? '' : ' · данные могли устареть'}`
      : '';
    box.hidden = false;
  }

  return {
    refresh() {
      if (pending) return pending;
      pending = client.request({ type: 'puzzles.refresh' })
        .then(value => {
          render(value);
          if (value.autoCompleted) onAutoComplete();
          return value;
        })
        .catch(error => {
          // Lichess failures arrive as a status; a rejected request is a storage or clock problem worth showing.
          render({ solved: null, status: 'offline' });
          onError(error);
          return null;
        })
        .finally(() => { pending = null; });
      return pending;
    },
  };
}
```

- [ ] **Step 4: Run the card tests**

Run: `node --test tests/puzzle-card.test.js`
Expected: PASS.

- [ ] **Step 5: Update the popup markup in `extension/ui/popup.html`**

Заменить строку 16 (`<section id="today-card" …>…</section>`) одной строкой:

```html
    <section id="today-card" class="card popup-card" aria-labelledby="popup-today" aria-busy="true"><div class="card-top"><p id="popup-today" class="eyebrow">СЕГОДНЯ</p><time id="today-date">Загрузка…</time></div><p class="task-target"><span id="puzzle-solved" hidden></span><span id="target">—</span> <span class="target-unit">задач</span></p><p class="muted">Ежедневная тактика на Lichess</p><div id="puzzle-progress" class="puzzle-progress" hidden><progress id="puzzle-bar" max="10" value="0" aria-label="Решено задач сегодня"></progress><p id="puzzle-phrase" class="puzzle-phrase" role="status"></p><p id="puzzle-meta" class="caption"></p></div><p id="today-status" class="task-status" role="status">Загружаем журнал…</p><a class="button button-primary" href="https://lichess.org/training" target="_blank" rel="noopener noreferrer">Открыть задачи ↗<span class="sr-only"> (в новой вкладке)</span></a><button id="completion" class="button button-secondary" type="button" aria-pressed="false" disabled>Отметить выполнение</button></section>
```

В строке 17 заменить подпись:

```html
<p class="caption popup-caption">Автоподсчёт по профилю Lichess · Время Бишкека</p>
```

- [ ] **Step 6: Wire the card in `extension/ui/popup.js`**

Заменить файл целиком:

```js
import { mountTrainingPage } from './page.js';
import { mountPractice } from './practice.js';
import { mountPuzzleCard } from './puzzle-card.js';

let practice;
let trainingLoaded = false;
const page = mountTrainingPage((snapshot) => {
  if (trainingLoaded || practice?.needsRefresh(snapshot.today.date)) void practice?.refresh();
  trainingLoaded = true;
});
practice = mountPractice({ client: page.client, compact: true, setExternalBusy: page.setExternalBusy });
void practice.refresh();
// Opening the popup takes the day's first reading before any puzzle is solved.
const puzzles = mountPuzzleCard({ client: page.client, onError: error => page.showError(error), onAutoComplete() {
  void page.controller.refresh();
  void practice.refresh();
} });
void puzzles.refresh();
document.getElementById('refresh').addEventListener('click', () => { void puzzles.refresh(); });
document.getElementById('open-dashboard').addEventListener('click', async () => {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('ui/dashboard.html') });
    window.close();
  } catch (error) { page.showError(error); }
});
```

- [ ] **Step 7: Add styles to `extension/ui/styles.css`**

После строки `.popup-card .button-secondary { margin-top: 8px; }` добавить:

```css
.puzzle-progress { margin-top: 12px; }
.puzzle-progress progress { display: block; width: 100%; height: 8px; accent-color: var(--green); }
.puzzle-progress progress[hidden] { display: none; }
.puzzle-phrase { margin-top: 8px; font-weight: 600; }
.puzzle-progress .caption { margin-top: 2px; }
#puzzle-solved { color: var(--green); }
```

- [ ] **Step 8: Run the full suite and the addon lint**

Run: `npm test && npm run lint:addon`
Expected: все тесты PASS; lint показывает `errors 0`, `notices 0`, `warnings 0`.

- [ ] **Step 9: Commit**

```bash
git add extension/ui/puzzle-card.js extension/ui/popup.html extension/ui/popup.js extension/ui/styles.css tests/puzzle-card.test.js
git commit -m "feat: show daily puzzle progress and encouragement in the popup"
```

---

### Task 7: Версия 0.4.1, сборка и документы

**Files:**
- Modify: `package.json`, `package-lock.json`, `extension/manifest.json` (версия)
- Modify: `docs/manual-qa.md` (раздел в конец)
- Modify: `docs/verification.md` (раздел 0.4.1 в начало, сразу после заголовка)
- Modify: `NOTES.md` (абзац в конец)

**Interfaces:**
- Consumes: всё из Task 1–6.
- Produces: `dist/lichess-training-0.4.1.zip` и записанные результаты проверок.

- [ ] **Step 1: Bump the version**

Run: `npm version 0.4.1 --no-git-tag-version`
Expected: `v0.4.1`; `package.json` и `package-lock.json` обновлены.

В `extension/manifest.json` заменить `"version": "0.4.0"` на `"version": "0.4.1"`.

Run: `grep -n '"version"' package.json extension/manifest.json`
Expected: обе строки `0.4.1`.

- [ ] **Step 2: Run tests, lint and build**

Run: `npm test 2>&1 | tail -8 && npm run lint:addon 2>&1 | tail -6 && npm run build:addon && unzip -l dist/lichess-training-0.4.1.zip | tail -3`
Expected: `# fail 0`; lint 0/0/0; архив создан. Запишите фактическое число тестов и файлов архива для Step 4.

Run: `unzip -l dist/lichess-training-0.4.1.zip | grep -E 'puzzle-card.js|puzzle-progress.js|app/puzzles.js'`
Expected: все три файла есть в архиве.

- [ ] **Step 3: Add the manual QA section to `docs/manual-qa.md`**

Дописать в конец файла:

```markdown
## Автоподсчёт задач: версия 0.4.1

Перед проверкой войдите в Lichess в том же Firefox. Анонимно решённые задачи в счётчик профиля не попадают. Доступ к lichess.org выдаётся кнопкой «Подключить Lichess» на основном экране.

| Шаг | Ожидаемый результат |
|---|---|
| Открыть popup впервые за день | «0 / 10 задач», «Начнём — 10 задач на сегодня», «счёт с ЧЧ:ММ · обновлено ЧЧ:ММ» |
| Решить 2 задачи на lichess.org/training, через минуту открыть popup | «2 / 10», полоса на 20 %, «Хорошее начало — осталось 8» |
| Открыть popup снова в течение минуты | Числа те же; новый запрос к `/api/user/` не идёт (вкладка Network в Inspect) |
| Дорешать до нормы и открыть popup | «Норма выполнена! +20 XP», статус «✓ Засчитано по счётчику Lichess», XP в строке программы +20 |
| Решить ещё задачи | «Сверх нормы: N задач»; XP не растёт |
| Нажать «Отменить отметку», через минуту открыть popup | Отметка снята и автоподсчётом не возвращается; XP −20 |
| Основной экран после автоотметки | Задание задач засчитано, подпись «Засчитано автоматически по счётчику задач Lichess.» |
| Отозвать доступ к lichess.org в настройках Firefox | «Автоподсчёт выключен: подключите Lichess на основном экране»; ручная кнопка работает |
| Отключить сеть, через минуту открыть popup | Прежние числа с пометкой «данные могли устареть» |
| Скачать backup v2 после автоотметки и восстановить | Автоотметка, запрет после отмены и XP сохраняются |
| Открыть popup после 00:00 по Бишкеку | Новый день начинается с «0 / N»; XP прошлых дней прежние |
```

- [ ] **Step 4: Record the results in `docs/verification.md`**

Сразу после первой строки-заголовка вставить раздел и подставить фактические числа из Step 2:

```markdown
## Автоподсчёт задач: 0.4.1 (2026-10-12)

- `npm test`: <N>/<N> тестов (Node 22), 0 падений. Новые файлы: `tests/puzzle-progress.test.js`, `tests/puzzle-service.test.js`, `tests/puzzle-card.test.js`, `tests/day-flags.test.js`; дополнены тесты клиента, репозитория, сервиса программы и UI.
- `web-ext lint`: 0 ошибок, 0 предупреждений, 0 notices.
- `web-ext build`: `dist/lichess-training-0.4.1.zip`, <M> файлов; есть `app/puzzles.js`, `core/puzzle-progress.js`, `ui/puzzle-card.js`. Версии manifest и package — 0.4.1.
- Источник счётчика проверен одним публичным запросом 2026-10-12: `GET /api/user/sebajun777` → `perfs.puzzle.games = 894`.
- Не проверено: реальный Firefox (маршрут «Автоподсчёт задач: версия 0.4.1» в `docs/manual-qa.md`).
```

- [ ] **Step 5: Append to `NOTES.md`**

Дописать в конец файла:

```markdown
## Автоподсчёт задач: 12 октября

При первой ручной проверке 0.4.0 пользователь решил несколько пазлов, а popup показывал «Сегодня ещё не отмечено». Отметка была ручной, а задачи решались в профиле `web-ext run` без входа в Lichess. Согласован автоподсчёт по публичному `perfs.puzzle.games`: первое показание дня по Бишкеку задаёт точку отсчёта, popup показывает «N / норма» с полосой и фразой поддержки, при достижении нормы задание засчитывается само (+20 XP). Ручная кнопка осталась; ручная отмена запрещает автоотметку до конца дня. Спецификация и план — в `docs/plans/`. Ручная проверка 0.4.1 в Firefox пользователем пока не выполнена.
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json extension/manifest.json docs/manual-qa.md docs/verification.md NOTES.md
git commit -m "chore: release 0.4.1 with puzzle auto-count"
```

---

## После плана

- Ревью всего диффа и самостоятельный прогон `npm test` и `npm run lint:addon`.
- Ingest в вики: спецификация, план, `docs/verification.md`, `docs/manual-qa.md`.
- Ручная проверка пользователем по разделу 0.4.1.
