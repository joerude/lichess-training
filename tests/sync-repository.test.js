import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';

const game = (id = 'abcdefgh') => ({ id, username: 'sebajun777', speed: 'bullet', createdAt: 1000, lastMoveAt: 2000,
  status: 'mate', rated: true, variant: 'standard', color: 'white', result: 'win', rating: 2100, ratingDiff: 8,
  opponent: { id: 'opponent', name: 'Opponent', rating: 2000 }, opening: { eco: 'C20', name: 'King Pawn' },
  moves: 'e4 e5', analysed: true, playerAnalysis: { acpl: 20, inaccuracy: 1, mistake: 3, blunder: 0 } });
const state = (revision = 1) => ({ revision, coverageStart: 0, cycleUntil: null, nextSince: null,
  completedUntil: 10000, lastSuccessAt: '2026-10-06T06:00:00.000Z', retryAfter: null });
const fixture = async () => {
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB });
  await repository.transact(() => ({ days: [{ date: '2026-10-06', completedAt: '2026-10-06T06:00:00Z' }] }));
  await repository.importHistory({ games: [game()], ratings: [{ name: 'Bullet', points: [{ date: '2026-03-15', rating: 2143 }] }],
    meta: { importedAt: '2026-10-04T12:00:00Z', sourceName: 'games_raw.ndjson' } });
  return { repository, indexedDB };
};

test('sync history reads its own state while old history/journal interfaces remain intact', async () => {
  const { repository, indexedDB } = await fixture();
  const before = await repository.readHistory();
  assert.deepEqual(await repository.readSyncHistory(), { ...before, sync: null });
  assert.deepEqual(await repository.saveSyncBatch({ games: [game('newgame1')], sync: state(), expectedRevision: 0 }), { added: 1, updated: 0, total: 2 });
  const recovered = createRepository({ indexedDB });
  assert.equal((await recovered.readSyncHistory()).games.length, 2);
  assert.deepEqual((await recovered.readSyncHistory()).sync, state());
  assert.deepEqual((await recovered.readHistory()).ratings, before.ratings);
  assert.deepEqual((await recovered.readHistory()).meta, before.meta);
  assert.equal((await recovered.read()).days.length, 1);
});

test('API refresh keeps known moves, ratings, opening and analysis when incoming fields are absent', async () => {
  const { repository } = await fixture();
  const incomplete = { ...game(), lastMoveAt: 3000, moves: '', opening: null, rating: null, ratingDiff: null,
    opponent: { ...game().opponent, rating: null }, analysed: false, playerAnalysis: null };
  assert.deepEqual(await repository.saveSyncBatch({ games: [incomplete], sync: state(), expectedRevision: 0 }), { added: 0, updated: 1, total: 1 });
  assert.deepEqual((await repository.readSyncHistory()).games[0], { ...game(), lastMoveAt: 3000 });
  assert.deepEqual(await repository.saveSyncBatch({ games: [incomplete], sync: state(2), expectedRevision: 1 }), { added: 0, updated: 0, total: 1 });
});

test('late aggregate analysis refreshes known fields and old lastMoveAt cannot replace newer facts', async () => {
  const { repository } = await fixture();
  const improved = { ...game(), lastMoveAt: 3000, playerAnalysis: { acpl: 18, inaccuracy: null, mistake: null, blunder: 0 } };
  await repository.saveSyncBatch({ games: [improved], sync: state(), expectedRevision: 0 });
  assert.deepEqual((await repository.readSyncHistory()).games[0].playerAnalysis, { acpl: 18, inaccuracy: 1, mistake: 3, blunder: 0 });
  const result = await repository.saveSyncBatch({ games: [{ ...game(), rating: 1 }], sync: state(2), expectedRevision: 1 });
  assert.equal(result.updated, 0);
  assert.equal((await repository.readSyncHistory()).games[0].rating, 2100);
});

test('stale revision or conflicting immutable game identity rejects the whole batch', async () => {
  const { repository } = await fixture();
  await repository.saveSyncBatch({ games: [], sync: state(), expectedRevision: 0 });
  const before = await repository.readSyncHistory();
  await assert.rejects(repository.saveSyncBatch({ games: [game('newgame1')], sync: state(), expectedRevision: 0 }), /друг|устар|измен/i);
  for (const replacement of [{ ...game(), createdAt: 999 }, { ...game(), opponent: { ...game().opponent, id: 'another' } }]) {
    await assert.rejects(repository.saveSyncBatch({ games: [game('newgame1'), replacement], sync: state(2), expectedRevision: 1 }));
    assert.deepEqual(await repository.readSyncHistory(), before);
  }
});

test('an abort after successful game writes also rolls back the sync cursor', async context => {
  const { repository } = await fixture();
  const before = await repository.readSyncHistory();
  const put = IDBObjectStore.prototype.put;
  context.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'games') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await assert.rejects(repository.saveSyncBatch({ games: [game('newgame1')], sync: state(), expectedRevision: 0 }));
  assert.deepEqual(await repository.readSyncHistory(), before);
});

test('historical import and journal restore do not remove API progress or overwrite API game updates', async () => {
  const { repository } = await fixture();
  await repository.saveSyncBatch({ games: [{ ...game(), lastMoveAt: 3000, rating: 2200 }], sync: state(), expectedRevision: 0 });
  await repository.importHistory({ games: [game()], ratings: null, meta: { sourceName: 'again.ndjson' } });
  await repository.transact(() => ({ days: [] }));
  assert.equal((await repository.readSyncHistory()).games[0].rating, 2200);
  assert.deepEqual((await repository.readSyncHistory()).sync, state());
});
