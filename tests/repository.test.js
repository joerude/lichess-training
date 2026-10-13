import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createTrainingService } from '../extension/app/training.js';

test('read starts empty and transact only resolves once new state is durable', async () => {
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB });
  assert.equal(await repository.read(), null);
  assert.deepEqual(await repository.transact(() => ({ count: 1 })), { count: 1 });
  assert.deepEqual(await createRepository({ indexedDB }).read(), { count: 1 });
});

test('transactions from independent connections serialize read-modify-write', async () => {
  const indexedDB = new IDBFactory();
  const first = createRepository({ indexedDB });
  const second = createRepository({ indexedDB });
  await first.transact(() => ({ count: 0 }));
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).transact(current => ({ count: current.count + 1 }))));
  assert.deepEqual(await first.read(), { count: 20 });
});

test('throwing updater aborts even after mutating the received state', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 1 }));
  await assert.rejects(repository.transact(current => {
    current.count = 100;
    throw new Error('updater failed');
  }), /updater failed/);
  assert.deepEqual(await repository.read(), { count: 1 });
});

test('asynchronous updaters are rejected without mutation', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 1 }));
  await assert.rejects(repository.transact(async () => ({ count: 2 })), /synchronous/i);
  assert.deepEqual(await repository.read(), { count: 1 });
});

test('storage clone failure rejects and leaves prior state intact', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 1 }));
  await assert.rejects(repository.transact(() => ({ bad: () => {} })));
  assert.deepEqual(await repository.read(), { count: 1 });
});

test('successful storage request followed by transaction abort never reports command success', async context => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const service = createTrainingService({ repository, now: () => new Date('2026-10-04T10:00:00.000Z') });
  await service.handle({ type: 'training.getSnapshot' });
  const before = await repository.read();
  const put = IDBObjectStore.prototype.put;
  context.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = put.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await assert.rejects(service.handle({ type: 'training.setCompletion', day: '2026-10-04', completed: true }), /abort/i);
  assert.deepEqual(await repository.read(), before);
});

test('returned and read objects cannot mutate stored state by reference', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const saved = await repository.transact(() => ({ nested: { count: 1 } }));
  saved.nested.count = 2;
  const read = await repository.read();
  read.nested.count = 3;
  assert.deepEqual(await repository.read(), { nested: { count: 1 } });
});

test('unavailable IndexedDB rejects commands with an actionable storage error', async () => {
  const service = createTrainingService({ repository: createRepository({ indexedDB: null }), now: () => new Date('2026-10-04T10:00:00.000Z') });
  await assert.rejects(service.handle({ type: 'training.setCompletion', day: '2026-10-04', completed: true }), /storage|IndexedDB|хранилищ/i);
});

const stored = { id: 'abcdefgh', username: 'sebajun777', speed: 'bullet', createdAt: 1000, lastMoveAt: 2000,
  status: 'mate', rated: true, variant: 'standard', color: 'white', result: 'win', rating: 1500, ratingDiff: 8,
  opponent: { id: 'opponent', name: 'Opponent', rating: 1500 }, opening: null, moves: 'e4 e5', analysed: false, playerAnalysis: null };
const series = { name: 'Bullet', points: [{ date: '2026-03-15', rating: 2143 }] };
const reading = { date: '2026-10-12', baseline: 894, latest: 896,
  baselineAt: '2026-10-12T03:14:00.000Z', observedAt: '2026-10-12T04:00:00.000Z' };

// Fills every store the extension writes: journal, practice, games, ratings, import and sync records, puzzle reading.
async function fillEverything(repository) {
  await repository.transactPractice(() => ({ journal: { profile: { username: 'sebajun777' }, days: [] },
    practice: { version: 1, rewards: [] }, puzzles: reading }));
  await repository.importHistory({ games: [stored], ratings: [series], meta: { importedAt: '2026-10-04T10:00:00.000Z', sourceName: 'games.ndjson' } });
  await repository.saveSyncBatch({ games: [], sync: { revision: 1, coverageStart: 0 }, expectedRevision: 0 });
}

test('clearAll empties the journal, practice, games, ratings, import, sync and puzzle records', async () => {
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB });
  await fillEverything(repository);
  const filled = await repository.readSyncHistory();
  assert.equal(filled.games.length, 1);
  assert.equal(filled.ratings.length, 1);
  assert.notEqual(filled.meta, null);
  assert.equal(filled.sync.revision, 1);
  assert.notEqual(await repository.read(), null);
  assert.deepEqual(await repository.readPuzzleReading(), reading);

  assert.equal(await repository.clearAll(), undefined);
  assert.equal(await repository.read(), null);
  assert.deepEqual(await repository.readPractice(), { journal: null, practice: null, games: [], sync: null, puzzles: null });
  assert.deepEqual(await repository.readSyncHistory(), { games: [], ratings: [], meta: null, sync: null });
  assert.equal(await repository.readPuzzleReading(), null);
  assert.deepEqual(await createRepository({ indexedDB }).readHistory(), { games: [], ratings: [], meta: null });

  await repository.clearAll();
  await repository.transact(() => ({ count: 1 }));
  assert.deepEqual(await createRepository({ indexedDB }).read(), { count: 1 });
});

test('clearAll on an empty database succeeds', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.clearAll();
  assert.equal(await repository.read(), null);
});

test('clearAll is one transaction: a failure part way keeps every store as it was', async context => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await fillEverything(repository);
  const before = { journal: await repository.read(), practice: await repository.readPractice(), history: await repository.readSyncHistory() };
  const clear = IDBObjectStore.prototype.clear;
  let cleared = 0;
  const mocked = context.mock.method(IDBObjectStore.prototype, 'clear', function (...args) {
    const request = clear.apply(this, args);
    request.addEventListener('success', () => { if (++cleared === 2) this.transaction.abort(); });
    return request;
  });
  await assert.rejects(repository.clearAll());
  assert.equal(mocked.mock.callCount(), 4, 'every store is cleared inside the same transaction');
  mocked.mock.restore();
  assert.deepEqual({ journal: await repository.read(), practice: await repository.readPractice(), history: await repository.readSyncHistory() }, before);
});
