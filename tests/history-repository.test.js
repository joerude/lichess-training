import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';

const game = (id = 'abcdefgh') => ({ id, username: 'sebajun777', speed: 'bullet', createdAt: 1000, lastMoveAt: 2000,
  status: 'mate', rated: true, variant: 'standard', color: 'white', result: 'win', rating: 1500, ratingDiff: 8,
  opponent: { id: 'opponent', name: 'Opponent', rating: 1500 }, opening: null, moves: 'e4 e5', analysed: false, playerAnalysis: null });
const rating = { name: 'Bullet', points: [{ date: '2026-03-15', rating: 2143 }] };
const meta = { importedAt: '2026-10-04T10:00:00.000Z', sourceName: 'games_raw.ndjson' };

test('history schema upgrades a v1 journal without losing its state', async () => {
  const indexedDB = new IDBFactory();
  const before = { profile: { username: 'sebajun777' }, days: [{ date: '2026-10-04', completedAt: '2026-10-04T10:00:00Z' }] };
  await new Promise((resolve, reject) => {
    const opening = indexedDB.open('lichess-training', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('journal');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('journal', 'readwrite');
      tx.objectStore('journal').put(before, 'state');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  });
  const repository = createRepository({ indexedDB });
  assert.deepEqual(await repository.read(), before);
  assert.deepEqual(await repository.readHistory(), { games: [], ratings: [], meta: null });
  assert.deepEqual(await repository.importHistory({ games: [game()], ratings: [rating], meta }), { added: 1, existing: 0, total: 1 });
  assert.deepEqual(await repository.read(), before);
  const restored = createRepository({ indexedDB });
  assert.deepEqual(await restored.readHistory(), { games: [game()], ratings: [rating], meta });
});

test('re-import adds zero games and preserves the originally saved record', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.importHistory({ games: [game()], ratings: [rating], meta });
  const result = await repository.importHistory({ games: [{ ...game(), rating: 1 }], ratings: null, meta });
  assert.deepEqual(result, { added: 0, existing: 1, total: 1 });
  assert.deepEqual((await repository.readHistory()).games, [game()]);
  assert.deepEqual((await repository.readHistory()).ratings, [rating]);
});

test('independent concurrent imports preserve a union of unique game IDs', async () => {
  const indexedDB = new IDBFactory();
  const first = createRepository({ indexedDB });
  const second = createRepository({ indexedDB });
  const results = await Promise.all([
    first.importHistory({ games: [game('aaaaaaaa'), game('bbbbbbbb')], ratings: null, meta }),
    second.importHistory({ games: [game('bbbbbbbb'), game('cccccccc')], ratings: null, meta }),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.added, 0), 3);
  assert.equal(results.reduce((sum, result) => sum + result.existing, 0), 1);
  assert.deepEqual((await first.readHistory()).games.map(g => g.id).sort(), ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']);
});

test('history transaction abort rolls back games, ratings and metadata together', async context => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 9 }));
  await repository.importHistory({ games: [game()], ratings: [rating], meta });
  const before = await repository.readHistory();
  const put = IDBObjectStore.prototype.put;
  context.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'games') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await assert.rejects(repository.importHistory({ games: [game('newgame1')],
    ratings: [{ name: 'Bullet', points: [{ date: '2026-03-16', rating: 1 }] }], meta: { ...meta, sourceName: 'other.ndjson' } }));
  assert.deepEqual(await repository.readHistory(), before);
  assert.deepEqual(await repository.read(), { count: 9 });
});

test('invalid history entries never publish a partial import', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.importHistory({ games: [game()], ratings: [rating], meta });
  const before = await repository.readHistory();
  for (const games of [[game('newgame1'), { ...game('newgame2'), moves: () => {} }], new Array(1)]) {
    await assert.rejects(repository.importHistory({ games, ratings: null, meta }));
    assert.deepEqual(await repository.readHistory(), before);
  }
});

test('replacing training marks keeps independently imported game history', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.importHistory({ games: [game()], ratings: [rating], meta });
  await repository.transact(() => ({ count: 1 }));
  await repository.transact(() => ({ count: 2 }));
  assert.deepEqual(await repository.readHistory(), { games: [game()], ratings: [rating], meta });
});
