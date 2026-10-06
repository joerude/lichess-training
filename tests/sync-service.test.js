import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createSyncService } from '../extension/app/sync.js';

const instant = new Date('2026-10-06T06:00:00Z');
const floor = instant.getTime() - 30 * 86400000;
const raw = (id, createdAt) => ({ id, rated: true, variant: 'standard', speed: 'bullet', status: 'mate',
  createdAt, lastMoveAt: createdAt + 1, winner: 'white',
  players: { white: { user: { id: 'sebajun777' }, rating: 2100, ratingDiff: 5 },
    black: { user: { id: 'opponent' }, rating: 2000, ratingDiff: -5 } }, moves: 'e4 e5' });
const page = records => ({ records, rows: records.length });
const fixture = fetchGamesPage => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  return { repository, service: createSyncService({ repository, lichess: { fetchGamesPage },
    canAccess: async () => true, now: () => instant }) };
};

test('reading sync snapshot starts no program and permission denial makes no network request', async () => {
  let requests = 0;
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const service = createSyncService({ repository, lichess: { fetchGamesPage: async () => { requests++; return page([]); } },
    canAccess: async () => false, now: () => instant });
  const snapshot = await service.handle({ type: 'sync.getSnapshot' });
  assert.equal(snapshot.permissionGranted, false);
  assert.equal(snapshot.overview.totalGames, 0);
  assert.equal(await repository.read(), null);
  await assert.rejects(service.handle({ type: 'sync.nextBatch' }), /разреш|доступ/i);
  assert.equal(requests, 0);
  assert.equal((await repository.readSyncHistory()).sync, null);
});

test('complete and repeated syncs preserve manual marks and do not duplicate games', async () => {
  const { service, repository } = fixture(async () => page([raw('today001', Date.parse('2026-10-06T05:00:00Z'))]));
  await repository.transact(() => ({ days: [{ date: '2026-10-06', completedAt: instant.toISOString() }] }));
  const before = await repository.read();
  const first = await service.handle({ type: 'sync.nextBatch' });
  assert.equal(first.report.added, 1);
  assert.equal(first.report.hasMore, false);
  assert.equal(first.snapshot.today.groups[0].games, 1);
  assert.equal(first.snapshot.sync.completedUntil, instant.getTime());
  const again = await service.handle({ type: 'sync.nextBatch' });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.updated, 0);
  assert.equal(again.report.total, again.snapshot.overview.totalGames);
  assert.deepEqual(await repository.read(), before);
});

test('a recreated service continues the frozen cycle from the inclusive timestamp', async () => {
  const records = Array.from({ length: 200 }, (_, index) => raw(`g${String(index).padStart(7, '0')}`, floor + index + 1));
  const { service, repository } = fixture(async () => page(records));
  const first = await service.handle({ type: 'sync.nextBatch' });
  assert.equal(first.report.hasMore, true);
  assert.equal(first.snapshot.sync.completedUntil, null);
  assert.equal(first.snapshot.sync.lastSuccessAt, null);
  let query;
  const recovered = createSyncService({ repository, now: () => new Date('2026-10-07T06:00:00Z'), canAccess: async () => true,
    lichess: { fetchGamesPage: async input => { query = input; return page([records.at(-1), raw('lastgame', floor + 201)]); } } });
  const last = await recovered.handle({ type: 'sync.nextBatch' });
  assert.deepEqual(query, { since: floor + 200, until: instant.getTime(), max: 200 });
  assert.equal(last.report.added, 1);
  assert.equal(last.report.total, 201);
  assert.equal(last.snapshot.sync.completedUntil, instant.getTime());
  assert.equal(last.snapshot.sync.coverageStart, floor);
});

test('the next full scan catches a game started before the previous update and finished later', async () => {
  let completed = false;
  const queries = [];
  const { service, repository } = fixture(async query => {
    queries.push(query);
    const game = raw('pending1', floor + 100);
    return page([{ ...game, status: completed ? 'mate' : 'started' }]);
  });
  const first = await service.handle({ type: 'sync.nextBatch' });
  assert.equal(first.report.skipped, 1);
  assert.equal(first.report.added, 0);
  completed = true;
  const later = await service.handle({ type: 'sync.nextBatch' });
  assert.equal(later.report.added, 1);
  assert.equal(queries[0].since, queries[1].since);
  assert.equal((await repository.readSyncHistory()).games.length, 1);
});

test('concurrent same-context clicks share a single active page request', async () => {
  let complete;
  let requests = 0;
  const { service } = fixture(() => { requests++; return new Promise(resolve => { complete = resolve; }); });
  const first = service.handle({ type: 'sync.nextBatch' });
  const second = service.handle({ type: 'sync.nextBatch' });
  first.catch(() => {});
  second.catch(() => {});
  for (let turn = 0; !complete && turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  complete(page([]));
  const replies = await Promise.all([first, second]);
  assert.deepEqual(replies[0], replies[1]);
});

test('failed or malformed pages preserve prior games, cursor and successful coverage', async () => {
  let fail = false;
  const { service, repository } = fixture(async () => {
    if (fail) return page([raw('newgame1', floor + 100), { ...raw('broken01', floor + 101), winner: 'invalid' }]);
    return page([raw('oldgame1', floor + 10)]);
  });
  await service.handle({ type: 'sync.nextBatch' });
  const before = await repository.readSyncHistory();
  fail = true;
  await assert.rejects(service.handle({ type: 'sync.nextBatch' }));
  assert.deepEqual(await repository.readSyncHistory(), before);
  const failed = createSyncService({ repository, lichess: { fetchGamesPage: async () => { throw new Error('Connection closed'); } },
    canAccess: async () => true, now: () => instant });
  await assert.rejects(failed.handle({ type: 'sync.nextBatch' }), /Connection closed/);
  assert.deepEqual(await repository.readSyncHistory(), before);
});

test('429 pause persists across service recreation without advancing cursor or successful coverage', async () => {
  const retryAt = instant.getTime() + 60000;
  const { service, repository } = fixture(async () => { const error = new Error('Too many requests'); error.retryAt = retryAt; throw error; });
  await assert.rejects(service.handle({ type: 'sync.nextBatch' }));
  const stored = (await repository.readSyncHistory()).sync;
  assert.equal(stored.retryAfter, retryAt);
  assert.equal(stored.completedUntil, null);
  assert.equal(stored.cycleUntil, null);
  let requests = 0;
  const recovered = createSyncService({ repository, lichess: { fetchGamesPage: async () => { requests++; return page([]); } },
    now: () => instant, canAccess: async () => true });
  await assert.rejects(recovered.handle({ type: 'sync.nextBatch' }), /пауз|повтор|Lichess/i);
  assert.equal(requests, 0);
  const resumed = createSyncService({ repository, lichess: { fetchGamesPage: async () => page([]) },
    now: () => new Date(retryAt + 1), canAccess: async () => true });
  assert.equal((await resumed.handle({ type: 'sync.nextBatch' })).snapshot.sync.retryAfter, null);
});

test('unknown commands and invalid clocks fail without network or cursor writes', async () => {
  let requests = 0;
  const { repository } = fixture(async () => page([]));
  const service = createSyncService({ repository, canAccess: async () => true, now: () => new Date(NaN),
    lichess: { fetchGamesPage: async () => { requests++; return page([]); } } });
  await assert.rejects(service.handle({ type: 'sync.nextBatch' }), /время/i);
  await assert.rejects(service.handle({ type: 'sync.unknown' }), /команд/i);
  assert.equal(requests, 0);
  assert.equal((await repository.readSyncHistory()).sync, null);
});
