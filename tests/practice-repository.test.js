import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';

test('practice reads journal, program, games and sync together without initialization', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  assert.deepEqual(await repository.readPractice(), { journal: null, practice: null, games: [], sync: null, puzzles: null });
  assert.equal(await repository.read(), null);
});

test('a practice transaction commits both journal records and preserves historical stores', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.importHistory({ games: [{ id: 'stored01' }], ratings: [{ name: 'Bullet', points: [] }], meta: { sourceName: 'original' } });
  await repository.saveSyncBatch({ games: [], sync: { revision: 1, coverageStart: 0 }, expectedRevision: 0 });
  const history = await repository.readSyncHistory();
  const result = await repository.transactPractice(current => {
    assert.equal(current.games[0].id, 'stored01');
    assert.equal(current.sync.revision, 1);
    return { journal: { days: ['2026-10-06'] }, practice: { rewards: [{ id: 'reward' }] } };
  });
  assert.deepEqual(result.journal, { days: ['2026-10-06'] });
  assert.deepEqual(result.practice, { rewards: [{ id: 'reward' }] });
  assert.deepEqual(await repository.readSyncHistory(), history);
  result.journal.days.push('caller mutation');
  result.practice.rewards.length = 0;
  const stored = await repository.readPractice();
  assert.deepEqual(stored.journal.days, ['2026-10-06']);
  assert.deepEqual(stored.practice.rewards, [{ id: 'reward' }]);
});

test('concurrent program transactions serialize facts and both records without lost updates', async () => {
  const indexedDB = new IDBFactory();
  const first = createRepository({ indexedDB });
  const second = createRepository({ indexedDB });
  const update = current => ({ journal: { count: (current.journal?.count ?? 0) + 1 },
    practice: { count: (current.practice?.count ?? 0) + 1 } });
  await Promise.all([first.transactPractice(update), second.transactPractice(update)]);
  const stored = await first.readPractice();
  assert.equal(stored.journal.count, 2);
  assert.equal(stored.practice.count, 2);
});

test('throwing, asynchronous or invalid program updates abort both records', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transactPractice(() => ({ journal: { value: 1 }, practice: { value: 2 } }));
  const before = await repository.readPractice();
  for (const update of [
    () => { throw new Error('Rejected'); },
    async () => ({ journal: { value: 3 }, practice: { value: 4 } }),
    () => ({ journal: { value: 3 }, practice: null }),
  ]) {
    await assert.rejects(repository.transactPractice(update));
    assert.deepEqual(await repository.readPractice(), before);
  }
});

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
