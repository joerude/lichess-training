import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createServices } from '../extension/app/services.js';

function fixture({ access = true, counts = [] } = {}) {
  let allowed = access;
  const repository = createRepository({ indexedDB: new IDBFactory() });
  let time = new Date('2026-10-12T03:14:00Z');
  let requests = 0;
  const lichess = {
    fetchGamesPage: async () => assert.fail('puzzle refresh must not request games'),
    async fetchPuzzleCount() {
      requests += 1;
      const next = counts.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    },
  };
  const service = createServices({ repository, now: () => time, lichess, canAccess: async () => allowed });
  return { repository, service, requests: () => requests, at: value => { time = new Date(value); },
    setAccess: value => { allowed = value; } };
}
const refresh = service => service.handle({ type: 'puzzles.refresh' });

test('the first refresh sets the baseline and later readings show progress', async () => {
  const f = fixture({ counts: [894, 898] });
  const first = await refresh(f.service);
  assert.deepEqual([first.status, first.date, first.solved, first.target, first.completed], ['ok', '2026-10-12', 0, 10, false]);
  assert.equal(first.reason, null);
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
  for (const [time, status, reason] of [['2026-10-12T04:00:00Z', 'offline', 'offline'], ['2026-10-12T04:02:00Z', 'rate-limited', 'pause'], ['2026-10-12T04:04:00Z', 'no-data', 'missing']]) {
    f.at(time);
    const result = await refresh(f.service);
    assert.deepEqual([result.status, result.solved, result.observedAt, result.reason], [status, 0, '2026-10-12T03:14:00.000Z', reason]);
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

test('revoked access keeps today\'s reading and reports no-permission without a request', async () => {
  const f = fixture({ counts: [894] });
  await refresh(f.service);
  f.setAccess(false);
  f.at('2026-10-12T03:20:00Z');
  const result = await refresh(f.service);
  assert.deepEqual([result.status, result.solved, result.observedAt, f.requests()], ['no-permission', 0, '2026-10-12T03:14:00.000Z', 1]);
});

test('a reading that arrives after midnight starts the new day', async () => {
  let f;
  f = fixture({ counts: [894, () => { f.at('2026-10-11T18:00:05Z'); return 904; }] });
  f.at('2026-10-11T17:00:00Z');
  await refresh(f.service);
  f.at('2026-10-11T17:59:50Z');
  const next = await refresh(f.service);
  assert.deepEqual([next.date, next.solved, next.baselineAt], ['2026-10-12', 0, '2026-10-11T18:00:05.000Z']);
});

test('an early undo does not block the automatic mark later that day', async () => {
  const f = fixture({ counts: [894, 896, 904] });
  await refresh(f.service);
  f.at('2026-10-12T03:20:00Z');
  await refresh(f.service);
  await f.service.handle({ type: 'training.setCompletion', day: '2026-10-12', completed: true });
  await f.service.handle({ type: 'training.setCompletion', day: '2026-10-12', completed: false });
  f.at('2026-10-12T04:00:00Z');
  const later = await refresh(f.service);
  assert.deepEqual([later.solved, later.completed, later.source, later.autoCompleted], [10, true, 'auto', true]);
});

test('a reading from yesterday is not shown when access is missing', async () => {
  const f = fixture({ counts: [894] });
  f.at('2026-10-11T15:00:00Z');
  await refresh(f.service);
  f.setAccess(false);
  f.at('2026-10-12T03:00:00Z');
  const result = await refresh(f.service);
  assert.deepEqual([result.status, result.date, result.solved, result.baselineAt, result.observedAt], ['no-permission', '2026-10-12', null, null, null]);
});
