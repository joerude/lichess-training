import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createServices } from '../extension/app/services.js';
import { initialState, setCompletion, backupFrom } from '../extension/core/training-engine.js';

const day = '2026-10-06';
const instant = new Date(`${day}T10:00:00Z`);
const game = (id, speed = 'bullet', date = day) => ({ id, username: 'sebajun777', createdAt: Date.parse(`${date}T09:00:00Z`),
  lastMoveAt: Date.parse(`${date}T09:01:00Z`), rated: true, variant: 'standard', status: 'mate', speed,
  color: 'white', result: 'win', rating: 2100, ratingDiff: 5, analysed: true,
  opponent: { id: 'opponent', name: 'Opponent', rating: 2000 }, moves: 'e4 e5', opening: null, playerAnalysis: null });
function fixture() {
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB });
  let time = instant;
  const now = () => time;
  const service = createServices({ repository, now, lichess: { fetchGamesPage: async () => assert.fail('program must not request Lichess') } });
  return { repository, service, indexedDB, now, advance: value => { time = new Date(value); } };
}
const read = service => service.handle({ type: 'program.getSnapshot' });
const importGames = (repository, games) => repository.importHistory({ games, ratings: null, meta: { sourceName: 'test' } });

test('program starts today and preserves earlier puzzle marks without rewarding historical games', async () => {
  const f = fixture();
  const old = setCompletion(initialState('2026-10-04'), '2026-10-04', true, new Date('2026-10-04T10:00:00Z'));
  await f.repository.transact(() => old);
  await importGames(f.repository, Array.from({ length: 10 }, (_, index) => game(`old${String(index).padStart(5, '0')}`, 'bullet', '2026-03-15')));
  const snapshot = await read(f.service);
  assert.equal(snapshot.program.startedOn, day);
  assert.deepEqual(snapshot.tasks.map(task => [task.id, task.target, task.current]), [['bullet', 5, 0], ['blitz', 5, 0], ['puzzles', 10, 0], ['reviews', 1, 0]]);
  assert.equal(snapshot.rewards.totalXp, 0);
  assert.deepEqual(await f.repository.read(), old);
});

test('completed tasks earn once, manual undo removes XP, redo restores one award', async () => {
  const f = fixture();
  await read(f.service);
  const games = Array.from({ length: 10 }, (_, index) => game(`today${String(index).padStart(3, '0')}`, index < 5 ? 'bullet' : 'blitz'));
  await importGames(f.repository, games);
  await importGames(f.repository, games);
  await f.service.handle({ type: 'training.setCompletion', day, completed: true });
  const completed = await f.service.handle({ type: 'program.saveReview', day, gameId: games[0].id, note: 'В следующий раз проверю угрозу соперника перед обменом.', expectedRevision: null });
  assert.equal(completed.rewards.totalXp, 80);
  assert.equal(completed.tasks.filter(task => task.completed).length, 4);
  assert.equal((await read(f.service)).rewards.totalXp, 80);
  const second = createServices({ repository: createRepository({ indexedDB: f.indexedDB }), now: f.now });
  await Promise.all([second.handle({ type: 'training.setCompletion', day, completed: true }), read(f.service)]);
  assert.equal((await read(second)).rewards.totalXp, 80);
  await f.service.handle({ type: 'training.setCompletion', day, completed: false });
  assert.equal((await read(f.service)).rewards.totalXp, 60);
  await f.service.handle({ type: 'training.setCompletion', day, completed: true });
  assert.equal((await read(f.service)).rewards.totalXp, 80);
  assert.equal((await f.repository.readPractice()).practice.rewards.length, 4);
});

test('future norms preserve an untouched today and activate after skipped days', async () => {
  const f = fixture();
  const original = await read(f.service);
  const targets = { bullet: 3, blitz: 2, rapid: 1, puzzles: 15, reviews: 2 };
  const changed = await f.service.handle({ type: 'program.configure', day, expectedRevision: original.program.revision, targets });
  assert.deepEqual(changed.program.targets, original.program.targets);
  assert.deepEqual(changed.program.pending, { effectiveFrom: '2026-10-07', targets });
  assert.equal((await f.service.handle({ type: 'training.getSnapshot' })).today.target, 10);
  f.advance('2026-10-09T10:00:00Z');
  const later = await read(f.service);
  assert.deepEqual(later.program.targets, targets);
  assert.equal((await f.service.handle({ type: 'training.getSnapshot' })).today.target, 15);
});

test('old game review counts on save day, edit cannot farm, stale edits and midnight reject', async () => {
  const f = fixture();
  await read(f.service);
  await importGames(f.repository, [game('oldgame1', 'rapid', '2026-03-15')]);
  const first = await f.service.handle({ type: 'program.saveReview', day, gameId: 'oldgame1', expectedRevision: null, note: 'Первый вывод.' });
  assert.equal(first.reviews[0].date, day);
  assert.equal(first.rewards.totalXp, 20);
  const revision = first.reviews[0].revision;
  await f.service.handle({ type: 'program.saveReview', day, gameId: 'oldgame1', expectedRevision: revision, note: 'Уточнённый вывод.' });
  await assert.rejects(f.service.handle({ type: 'program.saveReview', day, gameId: 'oldgame1', expectedRevision: revision, note: 'Старая правка.' }));
  const before = await f.repository.readPractice();
  f.advance('2026-10-06T18:00:00Z');
  await assert.rejects(f.service.handle({ type: 'program.deleteReview', day, gameId: 'oldgame1', expectedRevision: revision + 1 }), /день|дат/i);
  assert.deepEqual(await f.repository.readPractice(), before);
  const next = await read(f.service);
  assert.equal(next.rewards.totalXp, 20);
  assert.equal(next.reviews[0].date, day);
  assert.equal(next.tasks.find(task => task.id === 'reviews').current, 0);
});

test('backup v2 preview changes nothing and restores rules notes and rewards without erasing history', async () => {
  const f = fixture();
  await read(f.service);
  await importGames(f.repository, [game('review01')]);
  await f.service.handle({ type: 'training.setCompletion', day, completed: true });
  await f.service.handle({ type: 'program.saveReview', day, gameId: 'review01', expectedRevision: null, note: 'Сначала проверить шахи.' });
  const backup = await f.service.handle({ type: 'training.export' });
  assert.equal(backup.version, 2);
  const before = await f.repository.readPractice();
  const preview = await f.service.handle({ type: 'training.previewImport', backup });
  assert.equal(preview.reviewCount, 1);
  assert.equal(preview.totalXp, 40);
  assert.equal(preview.replacesPractice, true);
  assert.deepEqual(await f.repository.readPractice(), before);
  await f.service.handle({ type: 'training.setCompletion', day, completed: false });
  await f.service.handle({ type: 'program.deleteReview', day, gameId: 'review01', expectedRevision: 0 });
  assert.equal((await read(f.service)).rewards.totalXp, 0);
  await f.service.handle({ type: 'training.import', backup });
  const restored = await read(f.service);
  assert.equal(restored.rewards.totalXp, 40);
  assert.equal(restored.reviews[0].note, 'Сначала проверить шахи.');
  assert.equal((await f.repository.readHistory()).games.length, 1);
});

test('legacy v1 restore replaces puzzle marks and preserves current program and reviews', async () => {
  const f = fixture();
  await read(f.service);
  await importGames(f.repository, [game('review01')]);
  await f.service.handle({ type: 'program.saveReview', day, gameId: 'review01', expectedRevision: null, note: 'Свой разбор.' });
  const old = initialState(day);
  const backup = backupFrom(setCompletion(old, day, true, instant), instant);
  const before = (await f.repository.readPractice()).practice;
  await f.service.handle({ type: 'training.import', backup });
  const result = await read(f.service);
  assert.deepEqual(result.reviews, before.reviews);
  assert.equal(result.rewards.totalXp, 40);
  assert.equal((await f.service.handle({ type: 'training.getSnapshot' })).today.completed, true);
});

test('bad backup and conflicting rules leave all personal records unchanged', async () => {
  const f = fixture();
  const current = await read(f.service);
  const backup = await f.service.handle({ type: 'training.export' });
  const before = await f.repository.readPractice();
  backup.practice.rules.push({ effectiveFrom: '2026-02-30', targets: current.program.targets });
  await assert.rejects(f.service.handle({ type: 'training.import', backup }));
  await assert.rejects(f.service.handle({ type: 'program.configure', day, targets: current.program.targets, expectedRevision: current.program.revision + 1 }));
  assert.deepEqual(await f.repository.readPractice(), before);
});

test('transaction abort after journal put does not save a mark or its reward', async context => {
  const f = fixture();
  await read(f.service);
  const before = await f.repository.readPractice();
  const put = IDBObjectStore.prototype.put;
  context.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'journal') request.addEventListener('success', () => this.transaction.abort(), { once: true });
    return request;
  });
  await assert.rejects(f.service.handle({ type: 'training.setCompletion', day, completed: true }), /abort|отмен/i);
  assert.deepEqual(await f.repository.readPractice(), before);
});

test('V2 restore invalidates stale note and rule drafts even when saved versions coincide', async () => {
  const f = fixture();
  await read(f.service);
  await importGames(f.repository, [game('review01')]);
  const saved = await f.service.handle({ type: 'program.saveReview', day, gameId: 'review01', expectedRevision: null, note: 'Original' });
  const backup = await f.service.handle({ type: 'training.export' });
  await f.service.handle({ type: 'training.import', backup });
  const before = await f.repository.readPractice();
  await assert.rejects(f.service.handle({ type: 'program.saveReview', day, gameId: 'review01', expectedRevision: saved.reviews[0].revision, note: 'Stale draft' }), /верси|обнов/i);
  await assert.rejects(f.service.handle({ type: 'program.configure', day, expectedRevision: saved.program.revision, targets: saved.program.targets }), /верси|обнов/i);
  assert.deepEqual(await f.repository.readPractice(), before);
});

test('deleted-note version sequence survives V2 export and import', async () => {
  const f = fixture();
  await read(f.service);
  await importGames(f.repository, [game('review01')]);
  const first = await f.service.handle({ type: 'program.saveReview', day, gameId: 'review01', expectedRevision: null, note: 'Original' });
  await f.service.handle({ type: 'program.deleteReview', day, gameId: 'review01', expectedRevision: first.reviews[0].revision });
  const backup = await f.service.handle({ type: 'training.export' });
  await f.service.handle({ type: 'training.import', backup });
  const recreated = await f.service.handle({ type: 'program.saveReview', day, gameId: 'review01', expectedRevision: null, note: 'Replacement' });
  assert.ok(recreated.reviews[0].revision > first.reviews[0].revision);
});

test('a game committed by sync before the screen closed is rewarded once on the next program read', async () => {
  const f = fixture();
  await f.service.handle({ type: 'program.getSnapshot' });
  const original = await f.service.handle({ type: 'program.getSnapshot' });
  await f.service.handle({ type: 'program.configure', day, expectedRevision: original.program.revision, targets: { bullet: 1, blitz: 0, rapid: 0, puzzles: 10, reviews: 0 } });
  // норма применяется со следующего дня: переходим на него, чтобы bullet=1 действовала
  f.advance('2026-10-07T10:00:00Z');
  const nextDay = '2026-10-07';
  const first = await read(f.service);
  assert.equal(first.program.targets.bullet, 1);
  assert.equal(first.tasks.find(task => task.id === 'bullet').completed, false);
  const synced = { ...game('synced01', 'bullet', nextDay) };
  const sync = { revision: 1, coverageStart: 0, cycleUntil: null, completedUntil: Date.parse(`${nextDay}T09:30:00Z`) };
  // тот же путь, что у синка; сервис практики не вызывается
  await f.repository.saveSyncBatch({ games: [synced], sync, expectedRevision: 0 });
  const before = (await f.repository.readSyncHistory()).sync;

  const reopened = createServices({ repository: createRepository({ indexedDB: f.indexedDB }), now: f.now });
  const snapshot = await read(reopened);
  assert.equal(snapshot.tasks.find(task => task.id === 'bullet').completed, true);
  const bulletXp = (await f.repository.readPractice()).practice.rewards.filter(reward => reward.points === 20);
  assert.equal(bulletXp.length, 1);
  assert.equal(snapshot.rewards.totalXp, 20);
  assert.equal((await read(reopened)).rewards.totalXp, 20);
  assert.equal((await read(f.service)).rewards.totalXp, 20);
  assert.equal((await f.repository.readPractice()).practice.rewards.length, 1);
  const after = (await f.repository.readSyncHistory()).sync;
  assert.deepEqual(after, before);
  assert.equal(after.revision, 1);
});
