import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createServices } from '../extension/app/services.js';
import { createTrainingService } from '../extension/app/training.js';
import { setActiveProfile, clearActiveProfile, hasActiveProfile, activeProfile } from '../extension/core/profile.js';

// tests/setup.js gives every test file this profile; a test that clears it hands it back through t.after.
const SUITE_PROFILE = { username: 'sebajun777', timeZone: 'Asia/Bishkek' };
const NEW_YORK = { username: 'magnus_fan', timeZone: 'America/New_York' };
const NEED_PROFILE = 'Сначала укажите свой логин Lichess.';
const ALREADY_SET = 'Профиль уже задан. Чтобы сменить его, удалите данные в разделе «Профиль».';
const NEED_WORD = 'Для удаления данных введите слово «удалить».';
const USERNAME_ERROR = 'Логин Lichess: 2–30 символов, латинские буквы, цифры, «_» и «-».';
const ZONE_ERROR = 'Неизвестный часовой пояс.';

// A journal exactly as the versions before the profile setting wrote it.
const LEGACY_JOURNAL = {
  profile: { username: 'sebajun777', timeZone: 'Asia/Bishkek' },
  program: { id: 'daily-puzzles', title: 'Ежедневная тактика', target: 10, startedOn: '2026-10-04' },
  days: [{ date: '2026-10-04', target: 10, completedAt: '2026-10-04T10:00:00.000Z' }],
};

const rawGame = login => ({
  id: 'abcdefgh', rated: true, variant: 'standard', speed: 'bullet', status: 'mate', winner: 'white',
  createdAt: Date.parse('2026-10-05T10:00:00Z'), lastMoveAt: Date.parse('2026-10-05T10:01:00Z'),
  players: { white: { user: { id: login.toLowerCase(), name: login }, rating: 2100, ratingDiff: 5 },
    black: { user: { id: 'opponent', name: 'Opponent' }, rating: 2000, ratingDiff: -5 } },
  moves: 'e4 e5',
});
const RATINGS = [{ name: 'Bullet', points: [[2026, 2, 15, 1500]] }];

// 03:30 UTC on 13 October is still the evening of the 12th in New York but already the 13th in Bishkek.
function fixture(t, { now = '2026-10-13T03:30:00Z' } = {}) {
  // A freshly started background knows no profile; the suite profile is back when the test ends.
  clearActiveProfile();
  t.after(() => setActiveProfile(SUITE_PROFILE));
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const requests = { pages: 0, counter: 0 };
  const lichess = {
    async fetchGamesPage() { requests.pages += 1; return { records: [], rows: 0 }; },
    async fetchPuzzleCount() { requests.counter += 1; return 894; },
  };
  const create = () => createServices({ repository, now: () => new Date(now), lichess, canAccess: async () => true });
  // restart() is a background that was unloaded and woke up again: the same storage, no profile in memory.
  return { repository, requests, lichess, services: create(), restart() { clearActiveProfile(); return create(); } };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Lets pending storage work (fake-indexeddb steps through setImmediate) run its course.
async function settle() {
  for (let turn = 0; turn < 20; turn += 1) await new Promise(resolve => setImmediate(resolve));
}

const setupNewYork = services => services.handle({ type: 'profile.setup', username: 'Magnus_Fan', timeZone: 'America/New_York' });

const storesOf = async repository => ({
  journal: await repository.read(), practice: await repository.readPractice(), history: await repository.readSyncHistory(),
});

// Puts something into every store: journal, practice, games, ratings, import and sync records, puzzle reading.
async function fillStores({ services, repository }) {
  await services.handle({ type: 'training.setCompletion', day: '2026-10-12', completed: true });
  await services.handle({ type: 'history.import', gamesText: JSON.stringify(rawGame('Magnus_Fan')),
    ratingsText: JSON.stringify(RATINGS), sourceName: 'games.ndjson' });
  await services.handle({ type: 'sync.nextBatch' });
  await services.handle({ type: 'puzzles.refresh' });
  const { journal, practice, history } = await storesOf(repository);
  assert.equal(journal.days.length, 1);
  assert.notEqual(practice.practice, null);
  assert.notEqual(practice.puzzles, null);
  assert.equal(history.games.length, 1);
  assert.equal(history.ratings.length, 1);
  assert.notEqual(history.meta, null);
  assert.notEqual(history.sync, null);
}

test('without a journal profile.get answers null and every other command asks for a profile', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.services.handle({ type: 'profile.get' }), { profile: null });
  for (const command of [
    { type: 'training.getSnapshot' }, { type: 'training.export' }, { type: 'training.previewImport', backup: {} },
    { type: 'training.import', backup: {} }, { type: 'training.setCompletion', day: '2026-10-13', completed: true },
    { type: 'program.getSnapshot' }, { type: 'program.configure', day: '2026-10-13', targets: {}, expectedRevision: 0 },
    { type: 'history.getOverview' }, { type: 'history.previewImport', gamesText: '{}' }, { type: 'history.import', gamesText: '{}' },
    { type: 'sync.getSnapshot' }, { type: 'sync.nextBatch' }, { type: 'puzzles.refresh' },
  ]) {
    await assert.rejects(f.services.handle(command), { message: NEED_PROFILE, code: 'profile-required' }, command.type);
  }
  assert.deepEqual(f.requests, { pages: 0, counter: 0 });
  assert.equal(hasActiveProfile(), false);
  assert.deepEqual(await storesOf(f.repository), {
    journal: null, practice: { journal: null, practice: null, games: [], sync: null, puzzles: null },
    history: { games: [], ratings: [], meta: null, sync: null },
  }, 'nothing is created for an unknown profile');
});

test('profile.setup writes the journal of the new profile and the commands work for it', async t => {
  const f = fixture(t);
  assert.deepEqual(await setupNewYork(f.services), { profile: NEW_YORK });
  assert.deepEqual(await f.repository.read(), {
    profile: NEW_YORK,
    program: { id: 'daily-puzzles', title: 'Ежедневная тактика', target: 10, startedOn: '2026-10-12' },
    days: [],
  });
  assert.deepEqual(await f.services.handle({ type: 'profile.get' }), { profile: NEW_YORK });
  assert.deepEqual(activeProfile(), NEW_YORK);
  const program = await f.services.handle({ type: 'program.getSnapshot' });
  assert.deepEqual([program.profile, program.date], [NEW_YORK, '2026-10-12']);
  const marked = await f.services.handle({ type: 'training.setCompletion', day: '2026-10-12', completed: true });
  assert.deepEqual([marked.today.date, marked.today.completed], ['2026-10-12', true]);
  await assert.rejects(f.services.handle({ type: 'training.setCompletion', day: '2026-10-13', completed: true }), /день изменился/);
  const puzzles = await f.services.handle({ type: 'puzzles.refresh' });
  assert.deepEqual([puzzles.status, puzzles.date, puzzles.solved], ['ok', '2026-10-12', 0]);
  assert.equal(f.requests.counter, 1);
});

test('profile.setup trims the login and stores the time zone in its canonical spelling', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.services.handle({ type: 'profile.setup', username: '  Magnus_Fan ', timeZone: 'america/new_york' }), { profile: NEW_YORK });
  assert.deepEqual((await f.repository.read()).profile, NEW_YORK);
  assert.deepEqual(activeProfile(), NEW_YORK);
});

test('profile.setup refuses invalid input without leaving a journal or a profile behind', async t => {
  const f = fixture(t);
  for (const [fields, message] of [
    [{ username: 'x', timeZone: 'UTC' }, USERNAME_ERROR], [{ username: 'bad name', timeZone: 'UTC' }, USERNAME_ERROR],
    [{ timeZone: 'UTC' }, USERNAME_ERROR], [{ username: 'magnus_fan', timeZone: 'Mars/Olympus' }, ZONE_ERROR],
    [{ username: 'magnus_fan' }, ZONE_ERROR],
  ]) {
    await assert.rejects(f.services.handle({ type: 'profile.setup', ...fields }), { message });
  }
  assert.equal(await f.repository.read(), null);
  assert.equal(hasActiveProfile(), false);
  assert.deepEqual(await f.services.handle({ type: 'profile.get' }), { profile: null });
});

test('profile.setup that fails to write does not leave the new profile active', async t => {
  const f = fixture(t);
  const failing = t.mock.method(f.repository, 'transact', async () => { throw new Error('Disk full'); });
  await assert.rejects(setupNewYork(f.services), { message: 'Disk full' });
  assert.equal(hasActiveProfile(), false);
  await assert.rejects(f.services.handle({ type: 'program.getSnapshot' }), { code: 'profile-required' });
  failing.mock.restore();
  assert.deepEqual(await setupNewYork(f.services), { profile: NEW_YORK });
  assert.deepEqual((await f.repository.read()).profile, NEW_YORK);
});

test('a second profile.setup is refused and neither the journal nor the profile changes', async t => {
  const f = fixture(t);
  await setupNewYork(f.services);
  const before = await storesOf(f.repository);
  await assert.rejects(f.services.handle({ type: 'profile.setup', username: 'someone_else', timeZone: 'UTC' }), { message: ALREADY_SET });
  await assert.rejects(setupNewYork(f.services), { message: ALREADY_SET });
  assert.deepEqual(activeProfile(), NEW_YORK);
  assert.deepEqual(await storesOf(f.repository), before);
  const writes = t.mock.method(f.repository, 'transact');
  await assert.rejects(f.services.handle({ type: 'profile.setup', username: 'someone_else', timeZone: 'UTC' }), { message: ALREADY_SET });
  assert.equal(writes.mock.callCount(), 0, 'a refused profile is neither activated nor written');
  writes.mock.restore();

  // After a restart the journal decides, and the refused profile is not activated either.
  const restarted = f.restart();
  await assert.rejects(restarted.handle({ type: 'profile.setup', username: 'someone_else', timeZone: 'UTC' }), { message: ALREADY_SET });
  assert.equal(hasActiveProfile(), false);
  assert.deepEqual(await restarted.handle({ type: 'profile.get' }), { profile: NEW_YORK });
  const program = await restarted.handle({ type: 'program.getSnapshot' });
  assert.deepEqual([program.profile, program.date], [NEW_YORK, '2026-10-12']);
  assert.deepEqual(activeProfile(), NEW_YORK);
});

test('a journal that appears while profile.setup is running is not overwritten', async t => {
  const f = fixture(t);
  await f.repository.transact(() => structuredClone(LEGACY_JOURNAL));
  // The first check finds nothing, as if the journal had been written a moment later; the write must still refuse.
  t.mock.method(f.repository, 'read', async () => null);
  await assert.rejects(setupNewYork(f.services), { message: ALREADY_SET });
  assert.equal(hasActiveProfile(), false);
  assert.deepEqual((await f.repository.readPractice()).journal, LEGACY_JOURNAL);
});

test('profile.reset without the exact word changes nothing', async t => {
  const f = fixture(t);
  await setupNewYork(f.services);
  await fillStores(f);
  const before = await storesOf(f.repository);
  for (const confirm of [undefined, null, '', 'Удалить', ' удалить', 'удалить ', 'удалить!', 'delete', true, 1]) {
    await assert.rejects(f.services.handle({ type: 'profile.reset', confirm }), { message: NEED_WORD });
  }
  await assert.rejects(f.services.handle({ type: 'profile.reset' }), { message: NEED_WORD });
  assert.deepEqual(await storesOf(f.repository), before);
  assert.deepEqual(activeProfile(), NEW_YORK);
  assert.deepEqual(await f.services.handle({ type: 'profile.get' }), { profile: NEW_YORK });
});

test('a wipe that fails keeps the data and the profile', async t => {
  const f = fixture(t);
  await setupNewYork(f.services);
  await fillStores(f);
  const before = await storesOf(f.repository);
  const failing = t.mock.method(f.repository, 'clearAll', async () => { throw new Error('Disk full'); });
  await assert.rejects(f.services.handle({ type: 'profile.reset', confirm: 'удалить' }), { message: 'Disk full' });
  failing.mock.restore();
  assert.deepEqual(activeProfile(), NEW_YORK);
  assert.deepEqual(await storesOf(f.repository), before);
  assert.deepEqual(await f.services.handle({ type: 'profile.reset', confirm: 'удалить' }), { profile: null });
  assert.equal(await f.repository.read(), null);
});

test('profile.reset wipes every store, forgets the profile and lets another one be set up', async t => {
  const f = fixture(t);
  await setupNewYork(f.services);
  await fillStores(f);
  assert.deepEqual(await f.services.handle({ type: 'profile.reset', confirm: 'удалить' }), { profile: null });
  assert.equal(await f.repository.read(), null);
  assert.deepEqual(await f.repository.readPractice(), { journal: null, practice: null, games: [], sync: null, puzzles: null });
  assert.deepEqual(await f.repository.readSyncHistory(), { games: [], ratings: [], meta: null, sync: null });
  assert.equal(await f.repository.readPuzzleReading(), null);
  assert.equal(hasActiveProfile(), false);
  assert.deepEqual(await f.services.handle({ type: 'profile.get' }), { profile: null });
  await assert.rejects(f.services.handle({ type: 'program.getSnapshot' }), { code: 'profile-required' });
  assert.equal(await f.repository.read(), null, 'the refused command created nothing');
  // Nothing comes back after a restart, and a reset of an empty storage is harmless.
  const restarted = f.restart();
  await assert.rejects(restarted.handle({ type: 'training.getSnapshot' }), { code: 'profile-required' });
  assert.deepEqual(await restarted.handle({ type: 'profile.reset', confirm: 'удалить' }), { profile: null });

  assert.deepEqual(await restarted.handle({ type: 'profile.setup', ...SUITE_PROFILE }), { profile: SUITE_PROFILE });
  const program = await restarted.handle({ type: 'program.getSnapshot' });
  assert.deepEqual([program.profile, program.date, program.rewards.totalXp], [SUITE_PROFILE, '2026-10-13', 0]);
  assert.deepEqual((await f.repository.readSyncHistory()).games, []);
});

test('an existing journal of the original profile is picked up without setup', async t => {
  const f = fixture(t);
  await f.repository.transact(() => structuredClone(LEGACY_JOURNAL));
  assert.equal(hasActiveProfile(), false);
  assert.deepEqual(await f.services.handle({ type: 'profile.get' }), { profile: SUITE_PROFILE });
  const snapshot = await f.services.handle({ type: 'training.getSnapshot' });
  assert.deepEqual(activeProfile(), SUITE_PROFILE);
  assert.deepEqual([snapshot.profile, snapshot.today.date, snapshot.completedDays], [SUITE_PROFILE, '2026-10-13', 1]);
  const program = await f.services.handle({ type: 'program.getSnapshot' });
  assert.deepEqual([program.profile, program.date], [SUITE_PROFILE, '2026-10-13']);
  await assert.rejects(f.services.handle({ type: 'profile.setup', ...NEW_YORK }), { message: ALREADY_SET });
  assert.deepEqual((await f.repository.readPractice()).journal.profile, SUITE_PROFILE);
});

test('the profile is read from the journal once and then kept, also for simultaneous first commands', async t => {
  const f = fixture(t);
  await f.repository.transact(() => structuredClone(LEGACY_JOURNAL));
  const reads = t.mock.method(f.repository, 'read');
  await Promise.all([
    f.services.handle({ type: 'program.getSnapshot' }), f.services.handle({ type: 'training.getSnapshot' }),
    f.services.handle({ type: 'history.getOverview' }), f.services.handle({ type: 'sync.getSnapshot' }),
  ]);
  assert.equal(reads.mock.callCount(), 1);
  await f.services.handle({ type: 'puzzles.refresh' });
  await f.services.handle({ type: 'program.getSnapshot' });
  assert.equal(reads.mock.callCount(), 1);
});

test('commands that arrive during profile.setup wait for it', async t => {
  const f = fixture(t);
  const [setup, program] = await Promise.all([setupNewYork(f.services), f.services.handle({ type: 'program.getSnapshot' })]);
  assert.deepEqual(setup, { profile: NEW_YORK });
  assert.deepEqual([program.profile, program.date], [NEW_YORK, '2026-10-12']);
});

test('a command that arrives while profile.setup is writing the journal waits for the write', async t => {
  const f = fixture(t);
  const reached = deferred();
  const gate = deferred();
  const transact = f.repository.transact;
  t.mock.method(f.repository, 'transact', async (...args) => { reached.resolve(); await gate.promise; return transact(...args); });
  const setup = setupNewYork(f.services);
  await reached.promise;
  assert.deepEqual(activeProfile(), NEW_YORK, 'the profile is already active while the journal is being written');
  let finished = false;
  const program = f.services.handle({ type: 'program.getSnapshot' });
  program.then(() => { finished = true; }, () => { finished = true; });
  await settle();
  assert.equal(finished, false, 'the command must not create the journal ahead of the setup');
  gate.resolve();
  assert.deepEqual(await setup, { profile: NEW_YORK });
  assert.deepEqual([(await program).profile, hasActiveProfile()], [NEW_YORK, true]);
});

test('a command that arrives during profile.reset waits for it and then finds no profile', async t => {
  const f = fixture(t);
  await setupNewYork(f.services);
  const [reset, late, later] = await Promise.allSettled([
    f.services.handle({ type: 'profile.reset', confirm: 'удалить' }),
    f.services.handle({ type: 'history.import', gamesText: JSON.stringify(rawGame('Magnus_Fan')), sourceName: 'late.ndjson' }),
    f.services.handle({ type: 'program.getSnapshot' }),
  ]);
  assert.deepEqual(reset.value, { profile: null });
  for (const outcome of [late, later]) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.code, 'profile-required');
  }
  assert.deepEqual(await storesOf(f.repository), {
    journal: null, practice: { journal: null, practice: null, games: [], sync: null, puzzles: null },
    history: { games: [], ratings: [], meta: null, sync: null },
  }, 'nothing of the old profile is written after the wipe');
  assert.equal(hasActiveProfile(), false);
});

test('a journal with a damaged profile is reported, not guessed; reset clears it', async t => {
  const f = fixture(t);
  const { profile, ...withoutProfile } = LEGACY_JOURNAL;
  for (const [damaged, message] of [
    [{ ...LEGACY_JOURNAL, profile: { username: 'bad name!', timeZone: 'Asia/Bishkek' } }, USERNAME_ERROR],
    [{ ...LEGACY_JOURNAL, profile: { username: 'sebajun777', timeZone: 'Mars/Olympus' } }, ZONE_ERROR],
    [withoutProfile, 'Некорректный профиль.'],
  ]) {
    await f.repository.transact(() => structuredClone(damaged));
    const services = f.restart();
    await assert.rejects(services.handle({ type: 'profile.get' }), { message });
    await assert.rejects(services.handle({ type: 'program.getSnapshot' }), { message });
    assert.equal(hasActiveProfile(), false);
    await assert.rejects(services.handle({ type: 'profile.setup', ...NEW_YORK }), { message: ALREADY_SET });
  }
  assert.deepEqual(await f.restart().handle({ type: 'profile.reset', confirm: 'удалить' }), { profile: null });
  assert.equal(await f.repository.read(), null);
});

test('the training service on its own does not create a journal while no profile is known', async t => {
  const f = fixture(t);
  const training = createTrainingService({ repository: f.repository, now: () => new Date('2026-10-13T03:30:00Z') });
  for (const command of [
    { type: 'training.getSnapshot' }, { type: 'training.export' }, { type: 'training.setCompletion', day: '2026-10-13', completed: true },
  ]) {
    await assert.rejects(training.handle(command), { code: 'profile-required' }, command.type);
  }
  assert.equal(await f.repository.read(), null);
});

test('an unknown profile command is refused', async t => {
  const f = fixture(t);
  await assert.rejects(f.services.handle({ type: 'profile.unknown' }), { message: 'Неизвестная команда профиля.' });
  assert.equal(hasActiveProfile(), false);
});

const CHANGED = 'Профиль изменился во время загрузки. Повторите действие.';

// Starts `command` for alice_a, holds the Lichess reply, swaps the profile for bob_b and only then lets the reply through.
async function replyAfterProfileChange(t, command, reply) {
  const f = fixture(t);
  const gate = deferred();
  f.lichess.fetchPuzzleCount = async () => { await gate.promise; return 5000; };
  f.lichess.fetchGamesPage = async () => { await gate.promise; return reply; };
  await f.services.handle({ type: 'profile.setup', username: 'alice_a', timeZone: 'Asia/Bishkek' });
  const pending = f.services.handle(command);
  const outcome = pending.then(() => null, error => error);
  await settle();
  await f.services.handle({ type: 'profile.reset', confirm: 'удалить' });
  await f.services.handle({ type: 'profile.setup', username: 'bob_b', timeZone: 'Asia/Bishkek' });
  gate.resolve();
  return { f, error: await outcome };
}

test('a puzzle reading requested for the old profile is not written into the new one', async t => {
  const { f, error } = await replyAfterProfileChange(t, { type: 'puzzles.refresh' }, null);
  assert.equal(error?.message, CHANGED);
  const { practice, journal } = await storesOf(f.repository);
  assert.equal(practice.puzzles, null);
  assert.equal(journal.profile.username, 'bob_b');
});

test('a games page requested for the old profile is not written into the new one', async t => {
  const { f, error } = await replyAfterProfileChange(t, { type: 'sync.nextBatch' }, { records: [], rows: 0 });
  assert.equal(error?.message, CHANGED);
  const { history } = await storesOf(f.repository);
  assert.equal(history.sync, null);
  assert.equal(history.meta, null);
});
