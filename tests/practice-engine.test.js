import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, setCompletion } from '../extension/core/training-engine.js';
import * as engine from '../extension/core/practice-engine.js';

const today = '2026-10-06';
const instant = new Date('2026-10-06T10:00:00.000Z');
const targets = { bullet: 5, blitz: 5, rapid: 0, puzzles: 10, reviews: 1 };
const game = (id, speed = 'bullet', date = today, overrides = {}) => ({
  id, username: 'sebajun777', speed, createdAt: Date.parse(`${date}T06:00:00Z`),
  lastMoveAt: Date.parse(`${date}T06:02:00Z`), status: 'mate', rated: true,
  variant: 'standard', color: 'white', result: 'win', analysed: true, ...overrides,
});
const five = speed => Array.from({ length: 5 }, (_, i) => game(`${speed === 'bullet' ? 'u' : 'b'}000000${i}`, speed));
const snapshot = state => engine.practiceSnapshot({ ...state, sync: null }, today);

// A missing inheritance boundary would retroactively rewrite today's saved target.
test('initialization inherits today and restores the legacy default tomorrow without rewriting marks', () => {
  const journal = { ...initialState('2026-03-01'), days: [{ date: today, target: 17, completedAt: null }] };
  const before = structuredClone(journal);
  const practice = engine.initialPractice(journal, today);
  assert.deepEqual(practice.rules, [
    { effectiveFrom: today, targets: { ...targets, puzzles: 17 } },
    { effectiveFrom: '2026-10-07', targets },
  ]);
  assert.equal(practice.startedOn, today);
  assert.equal(practice.revision, 0);
  assert.deepEqual(journal, before);
  assert.equal(engine.getTargets(practice, today).puzzles, 17);
  assert.equal(engine.getTargets(practice, '2026-10-07').puzzles, 10);
});

test('configuration schedules tomorrow even if today has no mark and checks its version', () => {
  const practice = engine.initialPractice(initialState(today), today);
  const next = engine.configurePractice(practice, today, { ...targets, bullet: 2, puzzles: 20, extra: 90 }, 0);
  assert.equal(engine.getTargets(next, today).puzzles, 10);
  assert.deepEqual(engine.getTargets(next, '2026-10-07'), { ...targets, bullet: 2, puzzles: 20 });
  const replaced = engine.configurePractice(next, today, { ...targets, puzzles: 30 }, 1);
  assert.equal(replaced.rules.length, 2);
  assert.equal(replaced.revision, 2);
  assert.throws(() => engine.configurePractice(replaced, today, targets, 1), /верси|обнов/i);
  assert.equal(practice.rules.length, 1);
});

test('targets validate integer bounds and strip unknown keys', () => {
  assert.deepEqual(engine.normalizeTargets({ ...targets, extra: 3 }), targets);
  for (const change of [{ bullet: -1 }, { blitz: 101 }, { rapid: 1.5 }, { puzzles: 0 }, { puzzles: 501 }, { reviews: 11 }, { reviews: '1' }]) {
    assert.throws(() => engine.normalizeTargets({ ...targets, ...change }), /цел|норм|цель/i);
  }
});

test('rewards are stable per task, undo removes manual rewards, and redo earns one', () => {
  const journal = setCompletion(initialState(today), today, true, instant);
  const games = [...five('bullet'), ...five('blitz'), game('u0000000'), game('old00001', 'rapid', '2026-03-14')];
  const first = engine.reconcilePractice({ journal, practice: null, games }, today, instant);
  assert.equal(first.practice.rewards.length, 3);
  assert.deepEqual(first.practice.rewards.map(r => r.id).sort(), [
    '2026-10-06:2026-10-06:blitz', '2026-10-06:2026-10-06:bullet', '2026-10-06:2026-10-06:puzzles',
  ]);
  assert.equal(snapshot({ ...first, games }).rewards.totalXp, 60);
  const later = new Date('2026-10-06T11:00:00Z');
  const repeat = engine.reconcilePractice({ ...first, games }, today, later);
  assert.deepEqual(repeat.practice.rewards, first.practice.rewards);
  const undo = engine.reconcilePractice({ ...repeat, journal: setCompletion(first.journal, today, false, later), games: [] }, today, later);
  assert.equal(undo.practice.rewards.length, 2);
  const redo = engine.reconcilePractice({ ...undo, journal: setCompletion(undo.journal, today, true, later), games: [] }, today, later);
  assert.equal(redo.practice.rewards.length, 3);
  assert.equal(redo.practice.rewards.find(r => r.taskId === 'puzzles').earnedAt, later.toISOString());
  assert.equal(first.practice.rewards.length, 3);
});

test('rollover applies pending rules to unopened days and preserves each saved puzzle target', () => {
  let state = engine.reconcilePractice({ journal: initialState(today), practice: null, games: [] }, today, instant);
  state.practice = engine.configurePractice(state.practice, today, { ...targets, puzzles: 25 }, 0);
  const future = engine.reconcilePractice({ ...state, games: [game('future01', 'bullet', '2026-10-08')] }, '2026-10-08', new Date('2026-10-08T08:00:00Z'));
  assert.equal(future.journal.program.target, 25);
  assert.equal(future.journal.days.length, 0);
  assert.equal(engine.practiceSnapshot({ ...future, games: [], sync: null }, '2026-10-08').tasks.find(t => t.id === 'puzzles').target, 25);
  const saved = { ...future.journal, days: [{ date: '2026-10-08', target: 19, completedAt: null }] };
  const retained = engine.reconcilePractice({ ...future, journal: saved, games: [] }, '2026-10-08', new Date('2026-10-08T08:00:00Z'));
  assert.equal(retained.journal.program.target, 19);
});

test('old facts earn no XP; new discovery is dated by task day with later earnedAt', () => {
  const journal = { ...initialState('2026-03-01'), days: [{ date: '2026-03-14', target: 10, completedAt: '2026-03-14T08:00:00Z' }] };
  const initialized = engine.reconcilePractice({ journal, practice: null, games: five('bullet').map(g => ({ ...g, createdAt: Date.parse('2026-03-14T08:00:00Z') })) }, today, instant);
  assert.equal(initialized.practice.rewards.length, 0);
  const nextDay = new Date('2026-10-07T08:00:00Z');
  const recovered = engine.reconcilePractice({ ...initialized, games: five('bullet') }, '2026-10-07', nextDay);
  assert.deepEqual(recovered.practice.rewards, [{ id: `${today}:${today}:bullet`, date: today, taskId: 'bullet', points: 20, earnedAt: nextDay.toISOString() }]);
});

test('reviews count on the saving day; edits preserve date and enforce individual versions', () => {
  const practice = engine.initialPractice(initialState(today), today);
  const old = game('old00001', 'rapid', '2026-03-14');
  const saved = engine.saveReview(practice, [old], { gameId: old.id, note: '  Проверить эндшпиль  ', expectedRevision: null }, today, instant);
  assert.deepEqual(saved.reviews[0], { gameId: old.id, date: today, note: 'Проверить эндшпиль', createdAt: instant.toISOString(), updatedAt: instant.toISOString(), revision: 0 });
  const nextDay = '2026-10-07';
  const edited = engine.saveReview(saved, [], { gameId: old.id, note: 'Исправлено', expectedRevision: 0 }, nextDay, new Date('2026-10-07T10:00:00Z'));
  assert.equal(edited.reviews[0].date, today);
  assert.equal(edited.reviews[0].revision, 1);
  assert.equal(edited.reviews[0].createdAt, instant.toISOString());
  assert.throws(() => engine.saveReview(edited, [], { gameId: old.id, note: 'stale', expectedRevision: 0 }, nextDay, new Date('2026-10-07T10:00:00Z')), /верси|обнов/i);
  assert.throws(() => engine.deleteReview(edited, { gameId: old.id, expectedRevision: 0 }, nextDay), /верси|обнов/i);
  const state = engine.reconcilePractice({ journal: initialState(today), practice: edited, games: [] }, nextDay, new Date('2026-10-07T10:00:00Z'));
  assert.deepEqual(state.practice.rewards.map(r => r.date), [today]);
  const removed = engine.deleteReview(state.practice, { gameId: old.id, expectedRevision: 1 }, nextDay);
  assert.equal(engine.reconcilePractice({ ...state, practice: removed, games: [] }, nextDay, new Date('2026-10-07T10:00:00Z')).practice.rewards.length, 0);
  assert.equal(saved.reviews[0].note, 'Проверить эндшпиль');
});

test('new reviews require known eligible finished games and bounded UTF-8 notes', () => {
  const practice = engine.initialPractice(initialState(today), today);
  const input = { gameId: 'review01', note: '🙂'.repeat(1000), expectedRevision: null };
  assert.equal(engine.saveReview(practice, [game(input.gameId)], input, today, instant).reviews.length, 1);
  for (const overrides of [{ username: 'other' }, { rated: false }, { variant: 'chess960' }, { status: 'started' }, { speed: 'classical' }]) {
    assert.throws(() => engine.saveReview(practice, [game(input.gameId, 'bullet', today, overrides)], input, today, instant), /парт/i);
  }
  assert.throws(() => engine.saveReview(practice, [], input, today, instant), /парт/i);
  for (const note of [' ', '🙂'.repeat(1001), null]) {
    assert.throws(() => engine.saveReview(practice, [game(input.gameId)], { ...input, note }, today, instant), /замет|байт|разбор/i);
  }
  assert.throws(() => engine.saveReview(practice, [game(input.gameId)], input, today, new Date('2026-10-07T10:00:00Z')), /день|время/i);
  const full = { ...practice, reviews: Array.from({ length: 1000 }, (_, i) => ({ gameId: `r${i}`, date: today, note: 'x', createdAt: instant.toISOString(), updatedAt: instant.toISOString(), revision: 0 })) };
  assert.throws(() => engine.saveReview(full, [game(input.gameId)], input, today, instant), /1.?000|лимит/i);
});

test('snapshot orders enabled tasks and signals partial history without withholding proven completion', () => {
  const journal = setCompletion(initialState(today), today, true, instant);
  let practice = engine.initialPractice(journal, today);
  practice = engine.saveReview(practice, [game('review01')], { gameId: 'review01', note: 'Идея', expectedRevision: null }, today, instant);
  const games = [...five('bullet'), ...five('blitz')];
  const state = engine.reconcilePractice({ journal, practice, games }, today, instant);
  const view = snapshot({ ...state, games });
  assert.equal(view.date, today);
  assert.equal(view.program.id, 'daily-training');
  assert.deepEqual(view.tasks, [
    { id: 'bullet', target: 5, current: 5, completed: true, source: 'games' },
    { id: 'blitz', target: 5, current: 5, completed: true, source: 'games' },
    { id: 'puzzles', target: 10, current: 10, completed: true, source: 'manual' },
    { id: 'reviews', target: 1, current: 1, completed: true, source: 'review' },
  ]);
  assert.deepEqual(view.rewards, { totalXp: 80, level: 1, nextLevelXp: 20, gainedToday: 80 });
  assert.deepEqual(view.week.at(-1), { date: today, scheduled: true, completed: true });
  assert.equal(view.week[0].scheduled, false);
  assert.deepEqual(view.coverage, { coverageStart: null, completedUntil: null, partial: true });
  const startOfToday = Date.parse('2026-10-06T00:00:00.000+06:00');
  const midday = Date.parse('2026-10-06T06:00:00Z');
  const partialOf = sync => engine.practiceSnapshot({ ...state, games, sync }, today).coverage.partial;
  const sync = { coverageStart: 0, cycleUntil: null, completedUntil: midday };
  assert.equal(partialOf(sync), false);
  assert.deepEqual(engine.practiceSnapshot({ ...state, games, sync }, today).coverage, { coverageStart: 0, completedUntil: midday, partial: false });
  assert.equal(partialOf({ ...sync, completedUntil: startOfToday }), false);
  assert.equal(partialOf({ ...sync, completedUntil: startOfToday - 1 }), true);
  assert.equal(partialOf({ ...sync, completedUntil: Date.parse('2026-10-05T16:00:00Z') }), true);
  assert.equal(partialOf({ ...sync, cycleUntil: midday + 1 }), true);
  assert.equal(partialOf({ ...sync, completedUntil: null }), true);
  assert.equal(partialOf(null), true);
  assert.equal(engine.practiceSnapshot({ ...state, games: games.slice(0, 4), sync: null }, today).tasks[0].completed, false);
  view.reviews[0].note = 'external';
  view.program.targets.puzzles = 99;
  assert.equal(state.practice.reviews[0].note, 'Идея');
  assert.equal(engine.getTargets(state.practice, today).puzzles, 10);
});

test('review options contain only the latest 30 eligible distinct games', () => {
  const practice = engine.initialPractice(initialState(today), today);
  const games = Array.from({ length: 35 }, (_, i) => game(`g00000${String(i).padStart(2, '0')}`, 'bullet', today, { createdAt: instant.getTime() - i * 1000, lastMoveAt: instant.getTime() + 1000 }));
  games.push({ ...games[0] }, game('invalid1', 'bullet', today, { status: 'started' }));
  const view = snapshot({ journal: initialState(today), practice, games });
  assert.equal(view.reviewOptions.length, 30);
  assert.deepEqual(view.reviewOptions[0], { id: 'g0000000', speed: 'bullet', result: 'win', createdAt: instant.getTime() });
});

test('a stale revision cannot overwrite or delete a note recreated after deletion', () => {
  const journal = initialState(today);
  const practice = engine.initialPractice(journal, today);
  const input = { gameId: 'recreate', note: 'Original', expectedRevision: null };
  const saved = engine.saveReview(practice, [game(input.gameId)], input, today, instant);
  const staleRevision = saved.reviews[0].revision;
  const removed = engine.deleteReview(saved, { gameId: input.gameId, expectedRevision: staleRevision }, today);
  const replacement = engine.saveReview(removed, [game(input.gameId)], { ...input, note: 'Replacement' }, today, instant);
  assert.notEqual(replacement.reviews[0].revision, staleRevision);
  assert.throws(() => engine.saveReview(replacement, [], { ...input, expectedRevision: staleRevision }, today, instant), /верси|обнов/i);
  assert.throws(() => engine.deleteReview(replacement, { gameId: input.gameId, expectedRevision: staleRevision }, today), /верси|обнов/i);
});

test('a rolled-back clock rejects reconciliation rather than losing earned rewards without history', () => {
  const journal = initialState(today);
  const tomorrow = '2026-10-07';
  const saved = engine.reconcilePractice({ journal, practice: engine.initialPractice(journal, today), games: five('bullet').map(item => ({ ...item,
    createdAt: Date.parse(`${tomorrow}T06:00:00Z`), lastMoveAt: Date.parse(`${tomorrow}T06:02:00Z`) })) }, tomorrow, new Date(`${tomorrow}T10:00:00Z`));
  const original = structuredClone(saved);
  assert.throws(() => engine.reconcilePractice({ ...saved, games: [] }, today, instant), /дат|врем/i);
  assert.deepEqual(saved, original);
  const corrected = engine.reconcilePractice({ ...saved, games: [] }, tomorrow, new Date(`${tomorrow}T10:00:00Z`));
  assert.deepEqual(corrected.practice.rewards, saved.practice.rewards);
});
