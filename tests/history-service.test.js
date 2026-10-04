import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createHistoryService } from '../extension/app/history.js';
import { createTrainingService } from '../extension/app/training.js';

const raw = (id = 'abcdefgh') => ({ id, rated: true, variant: 'standard', speed: 'bullet', status: 'mate',
  createdAt: Date.parse('2026-03-15T10:00:00Z'), lastMoveAt: Date.parse('2026-03-15T10:01:00Z'), winner: 'white',
  players: { white: { user: { id: 'sebajun777', name: 'sebajun777' }, rating: 2135, ratingDiff: 8 },
    black: { user: { id: 'opponent', name: 'Opponent' }, rating: 2100, ratingDiff: -8 } }, moves: 'e4 e5' });
const now = () => new Date('2026-10-04T10:00:00Z');
const fixture = () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  return { repository, history: createHistoryService({ repository, now }), training: createTrainingService({ repository, now }) };
};
const input = () => ({ gamesText: JSON.stringify(raw()) + '\n' + JSON.stringify(raw()), sourceName: 'games_raw.ndjson',
  ratingsText: JSON.stringify([{ name: 'Bullet', points: [[2026, 2, 15, 2143]] }]) });

test('history preview validates and reports the file without writing or starting training', async () => {
  const { history, repository } = fixture();
  const preview = await history.handle({ type: 'history.previewImport', ...input() });
  assert.equal(preview.rows, 2);
  assert.equal(preview.unique, 1);
  assert.equal(preview.duplicates, 1);
  assert.equal(preview.skipped, 0);
  assert.equal(preview.ratingPoints, 1);
  assert.equal(await repository.read(), null);
  assert.deepEqual(await repository.readHistory(), { games: [], ratings: [], meta: null });
});

test('history import/re-import preserves the training journal and exact historical overview', async () => {
  const { history, training, repository } = fixture();
  await training.handle({ type: 'training.setCompletion', day: '2026-10-04', completed: true });
  const before = await repository.read();
  const saved = await history.handle({ type: 'history.import', ...input() });
  assert.equal(saved.report.added, 1);
  assert.equal(saved.report.total, 1);
  assert.equal(saved.overview.totalGames, 1);
  assert.equal(saved.overview.groups[0].wins, 1);
  assert.equal(saved.overview.groups[0].lastRating, 2143);
  assert.equal(saved.overview.importedAt, '2026-10-04T10:00:00.000Z');
  assert.deepEqual(await repository.read(), before);
  const again = await history.handle({ type: 'history.import', ...input(), ratingsText: null });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.existing, 1);
  assert.equal(again.overview.totalGames, 1);
  assert.equal(again.overview.ratings[0].points[0].rating, 2143);
  assert.deepEqual(await repository.read(), before);
});

test('malformed second line and wrong profile leave previously imported history intact', async () => {
  const { history, repository } = fixture();
  await history.handle({ type: 'history.import', ...input() });
  const before = await repository.readHistory();
  const other = raw('otherid1');
  other.players.white.user = { id: 'someoneelse', name: 'SomeoneElse' };
  for (const gamesText of [JSON.stringify(raw('newgame1')) + '\n{', JSON.stringify(other)]) {
    await assert.rejects(history.handle({ type: 'history.import', gamesText, sourceName: 'broken.ndjson' }));
    assert.deepEqual(await repository.readHistory(), before);
  }
});

test('history commands expose storage failure and capture an import timestamp once', async () => {
  let calls = 0;
  const service = createHistoryService({ repository: createRepository({ indexedDB: new IDBFactory() }),
    now: () => { calls += 1; return now(); } });
  await service.handle({ type: 'history.import', ...input() });
  assert.equal(calls, 1);
  const unavailable = createHistoryService({ repository: createRepository({ indexedDB: null }), now });
  await assert.rejects(unavailable.handle({ type: 'history.import', ...input() }), /storage|IndexedDB|хранилищ/i);
});

test('malformed history commands are rejected without introducing records', async () => {
  const { history, repository } = fixture();
  for (const command of [null, {}, { type: 'history.unknown' }, { type: 'history.import', gamesText: 12 }]) {
    await assert.rejects(history.handle(command));
  }
  assert.deepEqual(await repository.readHistory(), { games: [], ratings: [], meta: null });
});

test('overlapping imports report the same total as the overview returned to their pages', async () => {
  const { history, repository } = fixture();
  const second = createHistoryService({ repository, now });
  const replies = await Promise.all([
    history.handle({ type: 'history.import', gamesText: JSON.stringify(raw('firstone')), sourceName: 'first.ndjson' }),
    second.handle({ type: 'history.import', gamesText: JSON.stringify(raw('secondid')), sourceName: 'second.ndjson' }),
  ]);
  for (const reply of replies) {
    assert.equal(reply.report.added, 1);
    assert.equal(reply.report.total, reply.overview.totalGames);
  }
  assert.equal((await repository.readHistory()).games.length, 2);
});
