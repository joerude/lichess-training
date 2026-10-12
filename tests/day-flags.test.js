import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, setCompletion, snapshotFrom, normalizeBackup, backupFrom } from '../extension/core/training-engine.js';
import { reconcilePractice, practiceSnapshot } from '../extension/core/practice-engine.js';

const day = '2026-10-12';
const instant = new Date('2026-10-12T05:00:00Z');
const later = new Date('2026-10-12T06:00:00Z');
const autoDay = state => ({ ...state, days: [{ date: day, target: 10, completedAt: instant.toISOString(), source: 'auto' }] });

test('an undo suppresses automatic counting only when asked and a manual redo clears it', () => {
  const marked = setCompletion(initialState(day), day, true, instant);
  assert.deepEqual(marked.days, [{ date: day, target: 10, completedAt: instant.toISOString() }]);
  assert.deepEqual(setCompletion(marked, day, false, later).days, [{ date: day, target: 10, completedAt: null }]);
  const undone = setCompletion(marked, day, false, later, true);
  assert.deepEqual(undone.days, [{ date: day, target: 10, completedAt: null, autoSuppressed: true }]);
  const redone = setCompletion(undone, day, true, later);
  assert.deepEqual(redone.days, [{ date: day, target: 10, completedAt: later.toISOString() }]);
});

test('repeating a completion keeps the original time and the automatic source', () => {
  const state = autoDay(initialState(day));
  assert.deepEqual(setCompletion(state, day, true, later).days, state.days);
});

test('training snapshot reports who completed today', () => {
  assert.equal(snapshotFrom(initialState(day), day).today.source, null);
  assert.equal(snapshotFrom(setCompletion(initialState(day), day, true, instant), day).today.source, 'manual');
  assert.equal(snapshotFrom(autoDay(initialState(day)), day).today.source, 'auto');
});

test('backups keep source and suppression flags and still accept 0.4.0 days without them', () => {
  const state = { ...initialState('2026-10-10'), days: [
    { date: '2026-10-10', target: 10, completedAt: '2026-10-10T05:00:00.000Z' },
    { date: '2026-10-11', target: 10, completedAt: null, autoSuppressed: true },
    { date: day, target: 10, completedAt: instant.toISOString(), source: 'auto' },
  ] };
  assert.deepEqual(normalizeBackup(backupFrom(state, later), day).days, state.days);
});

for (const [name, change] of [
  ['an unknown source', entry => ({ ...entry, source: 'robot' })],
  ['a source without completion', entry => ({ ...entry, completedAt: null, source: 'auto' })],
  ['a suppression flag that is not true', entry => ({ ...entry, autoSuppressed: false })],
]) {
  test(`backup rejects ${name}`, () => {
    const state = { ...initialState(day), days: [change({ date: day, target: 10, completedAt: instant.toISOString() })] };
    assert.throws(() => normalizeBackup(backupFrom(state, later), day));
  });
}

test('program tasks show automatic puzzle completion', () => {
  const records = reconcilePractice({ journal: autoDay(initialState(day)), practice: null, games: [] }, day, later);
  const puzzles = practiceSnapshot(records, day).tasks.find(task => task.id === 'puzzles');
  assert.deepEqual([puzzles.completed, puzzles.source], [true, 'auto']);
});
