import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, backupFrom, setCompletion } from '../extension/core/training-engine.js';
import { initialPractice, saveReview, reconcilePractice } from '../extension/core/practice-engine.js';
import * as backup from '../extension/core/practice-backup.js';

const today = '2026-10-06';
const instant = new Date('2026-10-06T10:00:00.000Z');
const game = { id: 'review01', username: 'sebajun777', speed: 'bullet', status: 'mate', rated: true,
  variant: 'standard', result: 'win', createdAt: instant.getTime() - 10000, lastMoveAt: instant.getTime() - 1000 };
const state = () => {
  const journal = setCompletion(initialState(today), today, true, instant);
  const practice = saveReview(initialPractice(journal, today), [game], { gameId: game.id, note: 'Слишком быстро', expectedRevision: null }, today, instant);
  return reconcilePractice({ journal, practice, games: [] }, today, instant);
};
const fixture = () => ({ format: 'lichess-training-backup', version: 2, exportedAt: instant.toISOString(), state: state().journal, practice: state().practice });

// Dropping program records or retaining unknown fields breaks restored local state.
test('V2 roundtrip preserves notes, rules, rewards, canonical timestamps and strips unknown fields', () => {
  const source = state();
  const exported = backup.practiceBackupFrom(source, instant);
  assert.equal(exported.version, 2);
  assert.equal(exported.format, 'lichess-training-backup');
  exported.extra = 'omit';
  exported.practice.extra = true;
  exported.practice.rules[0].extra = true;
  exported.practice.rules[0].targets.extra = 10;
  exported.practice.reviews[0].extra = true;
  exported.practice.rewards[0].extra = true;
  exported.state.profile.extra = true;
  exported.exportedAt = '2026-10-06T16:00:00+06:00';
  const normalized = backup.normalizePracticeBackup(exported, today);
  assert.deepEqual(normalized, { version: 2, exportedAt: instant.toISOString(), journal: source.journal, practice: source.practice });
  assert.deepEqual(source, state());
  exported.state.days[0].target = 99;
  assert.equal(source.journal.days[0].target, 10);
  assert.deepEqual(backup.practiceBackupPreview(normalized), {
    version: 2, exportedAt: instant.toISOString(), profile: { username: 'sebajun777', timeZone: 'Asia/Bishkek' },
    startedOn: today, days: 1, completedDays: 1, puzzleTarget: 10, programStartedOn: today,
    ruleCount: 1, reviewCount: 1, totalXp: 40, replacesPractice: true,
  });
});

test('V1 imports use legacy limits and leave new practice replacement absent', () => {
  const journal = setCompletion(initialState('2026-03-01'), today, true, instant);
  const normalized = backup.normalizePracticeBackup(backupFrom(journal, instant), today);
  assert.deepEqual(normalized, { version: 1, exportedAt: instant.toISOString(), journal, practice: null });
  assert.deepEqual(backup.practiceBackupPreview(normalized), {
    version: 1, exportedAt: instant.toISOString(), profile: { username: 'sebajun777', timeZone: 'Asia/Bishkek' },
    startedOn: null, days: 1, completedDays: 1, puzzleTarget: 10, programStartedOn: '2026-03-01',
    ruleCount: 0, reviewCount: 0, totalXp: 0, replacesPractice: false,
  });
  const oversized = { ...backupFrom(journal, instant), junk: 'x'.repeat(2 * 1024 * 1024) };
  assert.throws(() => backup.normalizePracticeBackup(oversized, today), /2 МиБ/);
});

test('retained game awards survive restoration without game facts and discovery after task date', () => {
  const original = fixture();
  original.practice.startedOn = '2026-10-05';
  original.practice.rules[0].effectiveFrom = '2026-10-05';
  original.practice.rewards = [{ id: '2026-10-05:2026-10-05:bullet', date: '2026-10-05', taskId: 'bullet', points: 20, earnedAt: instant.toISOString() }];
  const restored = backup.normalizePracticeBackup(original, today);
  const reconciled = reconcilePractice({ ...restored, games: [] }, today, instant);
  assert.equal(reconciled.practice.rewards.filter(r => r.taskId === 'bullet').length, 1);
  assert.equal(reconciled.practice.rewards.find(r => r.taskId === 'bullet').earnedAt, instant.toISOString());
});

const invalid = [
  ['format', b => { b.format = 'foreign'; }],
  ['backup version', b => { b.version = 3; }],
  ['profile', b => { b.state.profile.username = 'other'; }],
  ['time zone', b => { b.state.profile.timeZone = 'UTC'; }],
  ['practice version', b => { b.practice.version = 2; }],
  ['negative revision', b => { b.practice.revision = -1; }],
  ['unsafe revision', b => { b.practice.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ['missing next review version', b => { delete b.practice.nextReviewRevision; }],
  ['unsafe next review version', b => { b.practice.nextReviewRevision = Number.MAX_SAFE_INTEGER + 1; }],
  ['reused next review version', b => { b.practice.nextReviewRevision = b.practice.reviews[0].revision; }],
  ['zero year', b => { b.practice.startedOn = '0000-10-06'; }],
  ['future start', b => { b.practice.startedOn = '2026-10-07'; }],
  ['empty rules', b => { b.practice.rules = []; }],
  ['first rule', b => { b.practice.rules[0].effectiveFrom = '2026-10-05'; }],
  ['future rule', b => { b.practice.rules.push({ ...b.practice.rules[0], effectiveFrom: '2026-10-08' }); }],
  ['duplicate rule', b => { b.practice.rules.push(b.practice.rules[0]); }],
  ['descending rules', b => { b.practice.startedOn = '2026-10-04'; b.practice.rules[0].effectiveFrom = '2026-10-04'; b.practice.rules.push({ ...b.practice.rules[0], effectiveFrom: '2026-10-06' }, { ...b.practice.rules[0], effectiveFrom: '2026-10-05' }); }],
  ['invalid target', b => { b.practice.rules[0].targets.reviews = 11; }],
  ['sparse rules', b => { b.practice.rules.length = 2; }],
  ['sparse reviews', b => { b.practice.reviews.length = 2; }],
  ['duplicate review', b => { b.practice.reviews.push(b.practice.reviews[0]); }],
  ['invalid game ID', b => { b.practice.reviews[0].gameId = 'wrong'; }],
  ['empty note', b => { b.practice.reviews[0].note = ' '; }],
  ['UTF8 note limit', b => { b.practice.reviews[0].note = '🙂'.repeat(1001); }],
  ['future review', b => { b.practice.reviews[0].date = '2026-10-07'; }],
  ['review before start', b => { b.practice.reviews[0].date = '2026-10-05'; }],
  ['review creation day', b => { b.practice.reviews[0].createdAt = '2026-10-05T10:00:00Z'; }],
  ['review reversed timestamps', b => { b.practice.reviews[0].updatedAt = '2026-10-06T09:00:00Z'; }],
  ['future review edit', b => { b.practice.reviews[0].updatedAt = '2026-10-07T10:00:00Z'; }],
  ['review revision', b => { b.practice.reviews[0].revision = -1; }],
  ['duplicate reward ID', b => { b.practice.rewards.push(b.practice.rewards[0]); }],
  ['sparse rewards', b => { b.practice.rewards.length += 1; }],
  ['reward namespace', b => { b.practice.rewards[0].id = 'foreign:2026-10-06:puzzles'; }],
  ['unknown task', b => { b.practice.rewards[0].taskId = 'analysis'; }],
  ['wrong points', b => { b.practice.rewards[0].points = 21; }],
  ['future reward', b => { b.practice.rewards[0].date = '2026-10-07'; }],
  ['reward before start', b => { b.practice.rewards[0].date = '2026-10-05'; }],
  ['reward earned before task', b => { b.practice.rewards[0].earnedAt = '2026-10-05T10:00:00Z'; }],
  ['reward earned future', b => { b.practice.rewards[0].earnedAt = '2026-10-07T10:00:00Z'; }],
  ['impossible timestamp', b => { b.practice.rewards[0].earnedAt = '2026-02-30T10:00:00Z'; }],
  ['future legacy completion', b => { b.state.days[0].date = '2026-10-07'; b.state.days[0].completedAt = '2026-10-07T10:00:00Z'; }],
  ['array root', b => Object.assign([], b)],
  ['array practice', b => { b.practice = []; }],
];
for (const [name, mutate] of invalid) {
  test(`rejects ${name} before changing source records`, () => {
    const input = fixture();
    const changed = mutate(input) ?? input;
    const before = structuredClone(changed);
    assert.throws(() => backup.normalizePracticeBackup(changed, today), /./);
    assert.deepEqual(changed, before);
  });
}

test('hostile last record rejects an otherwise valid backup without modifying earlier records', () => {
  const input = fixture();
  input.practice.rewards.push({ id: 'bad', date: today, taskId: 'bullet', points: 20, earnedAt: instant.toISOString() });
  const before = structuredClone(input);
  assert.throws(() => backup.normalizePracticeBackup(input, today));
  assert.deepEqual(input, before);
});

test('enforces collection and V2 total byte limits before restoration', () => {
  for (const [key, size] of [['rules', 10001], ['reviews', 1001], ['rewards', 50001]]) {
    const input = fixture();
    input.practice[key] = Array.from({ length: size }, () => input.practice[key][0]);
    assert.throws(() => backup.normalizePracticeBackup(input, today), /лимит|максимум|10 000|1 000|50 000/i);
  }
  const large = { ...fixture(), unknown: 'x'.repeat(16 * 1024 * 1024) };
  assert.throws(() => backup.normalizePracticeBackup(large, today), /16 МиБ/);
  const oversizedState = state();
  oversizedState.practice.unknown = 'x'.repeat(16 * 1024 * 1024);
  assert.throws(() => backup.practiceBackupFrom(oversizedState, instant), /16 МиБ/);
});
