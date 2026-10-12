import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, setCompletion } from '../extension/core/training-engine.js';
import { PUZZLE_REFRESH_MS, shouldFetchPuzzles, observePuzzleCount, solvedToday, applyAutoCompletion } from '../extension/core/puzzle-progress.js';

const day = '2026-10-12';
// Bishkek is UTC+6: 03:14Z is 09:14 local time on 12 October.
const at = time => new Date(`${day}T${time}Z`);

test('the first reading of the day becomes the baseline', () => {
  const record = observePuzzleCount(null, 894, at('03:14:00'), day);
  assert.deepEqual(record, { date: day, baseline: 894, latest: 894,
    baselineAt: '2026-10-12T03:14:00.000Z', observedAt: '2026-10-12T03:14:00.000Z' });
  assert.equal(solvedToday(record, day), 0);
});

test('later readings on the same day count from the baseline', () => {
  const first = observePuzzleCount(null, 894, at('03:14:00'), day);
  const second = observePuzzleCount(first, 898, at('04:02:00'), day);
  assert.equal(second.baselineAt, first.baselineAt);
  assert.equal(second.observedAt, '2026-10-12T04:02:00.000Z');
  assert.equal(solvedToday(second, day), 4);
});

test('a new Bishkek day starts a new baseline', () => {
  const yesterday = observePuzzleCount(null, 880, new Date('2026-10-11T15:00:00Z'), '2026-10-11');
  const today = observePuzzleCount(yesterday, 894, at('03:14:00'), day);
  assert.deepEqual([today.date, today.baseline, solvedToday(today, day)], [day, 894, 0]);
  assert.equal(solvedToday(yesterday, day), null);
});

test('a lower counter restarts the count instead of going negative', () => {
  const first = observePuzzleCount(null, 894, at('03:14:00'), day);
  const lower = observePuzzleCount(first, 890, at('04:00:00'), day);
  assert.deepEqual([lower.baseline, lower.latest, solvedToday(lower, day)], [890, 890, 0]);
});

test('invalid counters are rejected and broken records are ignored', () => {
  for (const count of [-1, 1.5, '894', null, NaN]) {
    assert.throws(() => observePuzzleCount(null, count, at('03:14:00'), day));
  }
  assert.equal(solvedToday({ date: day, baseline: 5, latest: 2 }, day), null);
  assert.equal(solvedToday({ date: day, baseline: 1, latest: 2, baselineAt: 'not a date', observedAt: '2026-10-12T03:14:00.000Z' }, day), null);
  assert.equal(shouldFetchPuzzles({ date: day }, at('03:14:00'), day), true);
});

test('a reading for today is reused for one minute', () => {
  const record = observePuzzleCount(null, 894, at('03:14:00'), day);
  const observed = Date.parse(record.observedAt);
  assert.equal(shouldFetchPuzzles(null, at('03:14:00'), day), true);
  assert.equal(shouldFetchPuzzles(record, new Date(observed + PUZZLE_REFRESH_MS - 1), day), false);
  assert.equal(shouldFetchPuzzles(record, new Date(observed + PUZZLE_REFRESH_MS), day), true);
  assert.equal(shouldFetchPuzzles(record, at('03:13:00'), day), true, 'a clock moved backwards asks again');
  const lateYesterday = observePuzzleCount(null, 894, new Date('2026-10-11T17:59:30Z'), '2026-10-11');
  assert.equal(shouldFetchPuzzles(lateYesterday, new Date('2026-10-11T18:00:10Z'), day), true, 'midnight needs a new baseline');
});

test('reaching the target marks the day automatically once', () => {
  const journal = initialState(day);
  assert.equal(applyAutoCompletion(journal, day, 9, at('04:00:00')), journal);
  const marked = applyAutoCompletion(journal, day, 10, at('04:00:00'));
  assert.deepEqual(marked.days, [{ date: day, target: 10, completedAt: '2026-10-12T04:00:00.000Z', source: 'auto' }]);
  assert.equal(applyAutoCompletion(marked, day, 12, at('05:00:00')), marked);
});

test('unknown counts, manual marks and a manual undo are left alone', () => {
  const journal = initialState(day);
  assert.equal(applyAutoCompletion(journal, day, null, at('04:00:00')), journal);
  for (const solved of [undefined, NaN, '10', 10.5]) assert.equal(applyAutoCompletion(journal, day, solved, at('04:00:00')), journal);
  const manual = setCompletion(journal, day, true, at('03:00:00'));
  assert.equal(applyAutoCompletion(manual, day, 10, at('04:00:00')), manual);
  const undone = setCompletion(manual, day, false, at('03:30:00'));
  assert.equal(applyAutoCompletion(undone, day, 15, at('04:00:00')), undone);
});

test('the day target overrides the program target', () => {
  const journal = { ...initialState(day), days: [{ date: day, target: 3, completedAt: null }] };
  assert.equal(applyAutoCompletion(journal, day, 3, at('04:00:00')).days[0].source, 'auto');
});
