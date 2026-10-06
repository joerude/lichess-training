import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncController, mountSync } from '../extension/ui/sync.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const snapshot = (revision = 0, overrides = {}) => ({
  overview: { totalGames: revision, firstGameAt: null, lastGameAt: null, importedAt: null, sourceName: null, groups: [], ratings: [] },
  sync: { revision, coverageStart: Date.parse('2026-03-10T18:00:00Z'), cycleUntil: null, nextSince: null, completedUntil: null, lastSuccessAt: null, retryAfter: null },
  today: { date: '2026-10-06', groups: [{ speed: 'bullet', games: 0 }, { speed: 'blitz', games: 0 }, { speed: 'rapid', games: 0 }] },
  permissionGranted: true,
  ...overrides,
});
const page = (revision, hasMore = false, overrides = {}) => ({ snapshot: snapshot(revision, overrides), report: { rows: 1, eligible: 1, skipped: 0, added: 1, updated: 0, total: revision, hasMore } });
function fixture(request) {
  const rendered = [], busy = [], errors = [], success = [], history = [];
  const controller = createSyncController({ client: { request }, render: (value) => rendered.push(value), setBusy: (value) => busy.push(value), showError: (error, source) => errors.push({ message: error.message, source }), showSuccess: (message) => success.push(message), onHistoryChanged: async () => history.push(rendered.at(-1).sync.revision) });
  return { controller, rendered, busy, errors, success, history };
}

test('permission denial and rejection preserve saved facts without requesting a batch', async () => {
  const { controller, rendered, errors, success } = fixture(async (command) => {
    assert.equal(command.type, 'sync.getSnapshot');
    return snapshot(3);
  });
  await controller.refresh();
  assert.equal(await controller.run(Promise.resolve(false)), false);
  assert.equal(await controller.run(Promise.reject(new Error('permission unavailable'))), false);
  assert.equal(rendered.at(-1).overview.totalGames, 3);
  assert.equal(errors.length, 2);
  assert.equal(success.length, 0);
});

test('reads and committed pages serialize and notify history after each commit', async () => {
  let finishRead, finishWrite;
  const commands = [];
  const { controller, rendered, busy, success, history } = fixture((command) => {
    commands.push(command.type);
    return new Promise((resolve) => { if (command.type === 'sync.getSnapshot') finishRead = resolve; else finishWrite = resolve; });
  });
  const read = controller.refresh();
  const run = controller.run(Promise.resolve(true));
  await settle();
  assert.deepEqual(commands, ['sync.getSnapshot']);
  finishRead(snapshot(1));
  await read;
  await settle();
  assert.deepEqual(commands, ['sync.getSnapshot', 'sync.nextBatch']);
  assert.deepEqual(success, []);
  finishWrite(page(2));
  await run;
  assert.deepEqual(rendered.map((value) => value.sync.revision), [1, 2]);
  assert.deepEqual(history, [2]);
  assert.deepEqual(busy, [true, false]);
  assert.equal(success.length, 1);
});

test('one click commits at most five pages and the next click resumes', async () => {
  let revision = 0;
  const { controller, rendered, history, success } = fixture(async () => page(++revision, revision < 7));
  await controller.run(Promise.resolve(true));
  assert.equal(rendered.length, 5);
  assert.deepEqual(history, [1, 2, 3, 4, 5]);
  assert.match(success.at(-1), /Продолж/);
  await controller.run(Promise.resolve(true));
  assert.equal(rendered.length, 7);
  assert.match(success.at(-1), /завершена/);
});

test('stop waits for the current page and suppresses the following request', async () => {
  let finish;
  let requests = 0;
  const { controller, rendered, success } = fixture(() => { requests++; return new Promise((resolve) => { finish = resolve; }); });
  const pending = controller.run(Promise.resolve(true));
  await settle();
  controller.stop();
  assert.equal(rendered.length, 0);
  finish(page(1, true));
  await pending;
  assert.equal(requests, 1);
  assert.equal(rendered.length, 1);
  assert.match(success.at(-1), /остановлена/);
});

test('a later page failure retains the first commit and never announces successful completion', async () => {
  let requests = 0;
  const { controller, rendered, errors, success, history, busy } = fixture(async () => {
    if (++requests === 1) return page(1, true);
    throw new Error('Сеть недоступна');
  });
  assert.equal(await controller.run(Promise.resolve(true)), false);
  assert.equal(rendered.at(-1).sync.revision, 1);
  assert.deepEqual(history, [1]);
  assert.deepEqual(success, []);
  assert.equal(errors.at(-1).source, 'sync.nextBatch');
  assert.deepEqual(busy, [true, false]);
});

test('permission revocation in a committed snapshot stops automatic paging', async () => {
  let requests = 0;
  const { controller, rendered, success } = fixture(async () => { requests++; return page(1, true, { permissionGranted: false }); });
  await controller.run(Promise.resolve(true));
  assert.equal(requests, 1);
  assert.equal(rendered.at(-1).permissionGranted, false);
  assert.match(success.at(-1), /доступ|Доступ/);
});

test('duplicate starts are ignored and rejected permission promises are handled while queued', async () => {
  let finishRead;
  const { controller, errors } = fixture(() => new Promise((resolve) => { finishRead = resolve; }));
  const read = controller.refresh();
  const run = controller.run(Promise.reject(new Error('Denied while queued')));
  assert.equal(await controller.run(Promise.reject(new Error('Duplicate denial'))), false);
  await settle();
  finishRead(snapshot());
  await read;
  assert.equal(await run, false);
  assert.equal(errors.length, 1);
});

function domFixture() {
  const ids = ['sync-card', 'sync-date', 'sync-bullet', 'sync-blitz', 'sync-rapid', 'sync-state', 'sync-coverage', 'sync-completed', 'sync-last-success', 'sync-total', 'sync-run', 'sync-stop', 'sync-error', 'sync-notice', 'sync-retry'];
  function target() {
    const handlers = new Map();
    return { textContent: '', hidden: false, disabled: false, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, handler) { handlers.set(type, handler); },
      dispatch(type) { handlers.get(type)?.(); },
    };
  }
  const elements = Object.fromEntries(ids.map((id) => [id, target()]));
  const document = { ...target(), visibilityState: 'visible', getElementById: (id) => elements[id] };
  const window = target();
  const timers = new Map();
  let timerId = 0;
  return { elements, document, window, timers,
    setTimer(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback: () => { timers.delete(id); return callback(); }, delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
  };
}

test('mount requests Firefox permission in the click gesture before waiting for queued reads', async () => {
  const dom = domFixture();
  let finishRead;
  let inClick = false;
  const commands = [], requested = [];
  const panel = mountSync({ ...dom, client: { request(command) { commands.push(command.type); return new Promise((resolve) => { finishRead = resolve; }); } }, setExternalBusy() {}, onHistoryChanged: async () => {}, permissions: { request(value) { assert.equal(inClick, true); requested.push(value); return Promise.resolve(false); } } });
  assert.deepEqual(commands, []);
  const read = panel.refresh();
  await settle();
  inClick = true;
  dom.elements['sync-run'].dispatch('click');
  inClick = false;
  assert.deepEqual(requested, [{ origins: ['https://lichess.org/*'], data_collection: ['authenticationInfo'] }]);
  finishRead(snapshot());
  await read;
  await settle();
  assert.deepEqual(commands, ['sync.getSnapshot']);
  assert.equal(dom.elements['sync-error'].hidden, false);
});

test('mount shows individual stored counts, empty coverage and unfinished progress without declaring freshness', async () => {
  const dom = domFixture();
  let value = snapshot(0, { permissionGranted: false });
  const panel = mountSync({ ...dom, client: { request: async () => value }, setExternalBusy() {}, onHistoryChanged: async () => {}, permissions: { request: async () => true } });
  await panel.refresh();
  assert.equal(dom.elements['sync-run'].textContent, 'Подключить Lichess');
  assert.equal(dom.elements['sync-bullet'].textContent, '0');
  assert.match(dom.elements['sync-state'].textContent, /нет|Нет/);
  assert.match(dom.elements['sync-completed'].textContent, /не|Не/);
  value = snapshot(9, { sync: { ...snapshot().sync, revision: 9, cycleUntil: Date.parse('2026-10-06T12:00:00Z'), nextSince: Date.parse('2026-03-12T00:00:00Z') }, today: { date: '2026-10-06', groups: [{ speed: 'bullet', games: 2 }, { speed: 'blitz', games: 3 }, { speed: 'rapid', games: 4 }] } });
  await panel.refresh();
  assert.equal(dom.elements['sync-run'].textContent, 'Продолжить загрузку');
  assert.deepEqual(['bullet', 'blitz', 'rapid'].map((speed) => dom.elements[`sync-${speed}`].textContent), ['2', '3', '4']);
  assert.match(dom.elements['sync-state'].textContent, /не завершена/);
  assert.match(dom.elements['sync-date'].textContent, /2026/);
  assert.match(dom.elements['sync-coverage'].textContent, /11.*03.*2026/);
});

test('focus snapshot refresh preserves an earlier batch error and never requests network pages', async () => {
  const dom = domFixture();
  const commands = [];
  const panel = mountSync({ ...dom, client: { request: async (command) => { commands.push(command.type); if (command.type === 'sync.nextBatch') throw new Error('Сеть недоступна'); return snapshot(3); } }, setExternalBusy() {}, onHistoryChanged: async () => {}, permissions: { request: async () => true } });
  await panel.refresh();
  dom.elements['sync-run'].dispatch('click');
  await settle();
  const message = dom.elements['sync-error'].textContent;
  dom.window.dispatch('focus');
  await settle();
  assert.equal(dom.elements['sync-error'].hidden, false);
  assert.equal(dom.elements['sync-error'].textContent, message);
  assert.deepEqual(commands, ['sync.getSnapshot', 'sync.nextBatch', 'sync.getSnapshot', 'sync.getSnapshot']);
});

test('persisted cooldown re-enables the run button when its deadline passes', async () => {
  const dom = domFixture();
  let now = 1000;
  const value = snapshot(1, { sync: { ...snapshot().sync, retryAfter: 1500 } });
  const panel = mountSync({ ...dom, client: { request: async () => value }, setExternalBusy() {}, onHistoryChanged: async () => {}, permissions: { request: async () => true }, now: () => now });
  await panel.refresh();
  assert.equal(dom.elements['sync-run'].disabled, true);
  assert.equal(dom.elements['sync-retry'].hidden, false);
  now = 1500;
  [...dom.timers.values()].find((timer) => timer.delay === 500).callback();
  assert.equal(dom.elements['sync-run'].disabled, false);
  assert.equal(dom.elements['sync-retry'].hidden, true);
});

for (const snapshotFails of [false, true]) {
  test(`a failed batch reads only local cooldown and preserves the original error when snapshot ${snapshotFails ? 'fails' : 'succeeds'}`, async () => {
    const commands = [];
    let pages = 0;
    const { controller, rendered, errors, success, history } = fixture(async (command) => {
      commands.push(command.type);
      if (command.type === 'sync.nextBatch') {
        if (++pages === 1) return page(1, true);
        throw new Error('Lichess просит подождать');
      }
      if (snapshotFails) throw new Error('Хранилище недоступно');
      return snapshot(1, { sync: { ...snapshot().sync, revision: 1, retryAfter: 1500 } });
    });
    assert.equal(await controller.run(Promise.resolve(true)), false);
    assert.deepEqual(commands, ['sync.nextBatch', 'sync.nextBatch', 'sync.getSnapshot']);
    assert.deepEqual(errors, [{ message: 'Lichess просит подождать', source: 'sync.nextBatch' }]);
    assert.equal(rendered.at(-1).sync.revision, 1);
    assert.equal(rendered.at(-1).sync.retryAfter, snapshotFails ? null : 1500);
    assert.deepEqual(success, []);
    assert.deepEqual(history, [1]);
  });
}

test('failed batch immediately displays persisted cooldown and keeps its original action error', async () => {
  const dom = domFixture();
  const commands = [];
  let failed = false;
  const panel = mountSync({ ...dom,
    client: { request: async (command) => {
      commands.push(command.type);
      if (command.type === 'sync.nextBatch') { failed = true; throw new Error('Lichess просит подождать'); }
      return snapshot(3, { sync: { ...snapshot().sync, revision: 3, retryAfter: failed ? 1500 : null } });
    } },
    setExternalBusy() {}, onHistoryChanged: async () => {}, permissions: { request: async () => true }, now: () => 1000, setTimer: () => 1, clearTimer() {},
  });
  await panel.refresh();
  dom.elements['sync-run'].dispatch('click');
  await settle();
  assert.deepEqual(commands, ['sync.getSnapshot', 'sync.nextBatch', 'sync.getSnapshot']);
  assert.equal(dom.elements['sync-run'].disabled, true);
  assert.equal(dom.elements['sync-retry'].hidden, false);
  assert.equal(dom.elements['sync-error'].hidden, false);
  assert.match(dom.elements['sync-error'].textContent, /Lichess просит подождать/);
  assert.equal(dom.elements['sync-notice'].hidden, true);
});


test('focused sync panel refreshes stored date and counts at Bishkek midnight without requesting network', async () => {
  const dom = domFixture();
  const boundary = Date.parse('2026-10-06T18:00:00Z');
  let instant = boundary - 1000;
  const commands = [];
  const panel = mountSync({ ...dom, now: () => instant,
    client: { request: async (command) => {
      commands.push(command.type);
      assert.equal(command.type, 'sync.getSnapshot');
      return snapshot(1, { today: { date: instant < boundary ? '2026-10-06' : '2026-10-07', groups: [{ speed: 'bullet', games: instant < boundary ? 1 : 0 }, { speed: 'blitz', games: 0 }, { speed: 'rapid', games: 0 }] } });
    } }, setExternalBusy() {}, onHistoryChanged: async () => {}, permissions: { request: async () => assert.fail('midnight must not ask permission') },
  });
  assert.deepEqual(commands, []);
  await panel.refresh();
  assert.equal(dom.elements['sync-date'].attributes.datetime, '2026-10-06');
  assert.equal(dom.elements['sync-bullet'].textContent, '1');
  const timer = [...dom.timers.values()].find((value) => value.delay === 1050);
  assert.ok(timer, 'a stored-data refresh should be scheduled for Bishkek midnight');
  instant = boundary + 50;
  await timer.callback();
  assert.equal(dom.elements['sync-date'].attributes.datetime, '2026-10-07');
  assert.equal(dom.elements['sync-bullet'].textContent, '0');
  assert.deepEqual(commands, ['sync.getSnapshot', 'sync.getSnapshot']);
  assert.equal(dom.timers.size, 1);
  assert.equal([...dom.timers.values()][0].delay, 86400000);
});

test('suspended sync panel cancels the old day timer and reschedules a fresh local read on pageshow', async () => {
  const dom = domFixture();
  let instant = Date.parse('2026-10-06T17:59:59Z');
  const commands = [];
  const panel = mountSync({ ...dom, now: () => instant,
    client: { request: async (command) => {
      commands.push(command.type);
      assert.equal(command.type, 'sync.getSnapshot');
      return snapshot(1, { today: { date: instant < Date.parse('2026-10-06T18:00:00Z') ? '2026-10-06' : '2026-10-08', groups: [{ speed: 'bullet', games: instant < Date.parse('2026-10-06T18:00:00Z') ? 1 : 0 }] } });
    } }, setExternalBusy() {}, onHistoryChanged: async () => {},
  });
  await panel.refresh();
  assert.equal(dom.timers.size, 1);
  dom.window.dispatch('pagehide');
  assert.equal(dom.timers.size, 0);
  instant = Date.parse('2026-10-07T18:00:01Z');
  dom.window.dispatch('pageshow');
  await settle();
  assert.equal(dom.elements['sync-date'].attributes.datetime, '2026-10-08');
  assert.equal(dom.elements['sync-bullet'].textContent, '0');
  assert.equal(dom.timers.size, 1);
  assert.equal([...dom.timers.values()][0].delay, 86399050);
  assert.deepEqual(commands, ['sync.getSnapshot', 'sync.getSnapshot']);
});
