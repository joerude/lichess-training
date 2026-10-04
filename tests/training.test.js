import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { dayKey } from '../extension/core/training-engine.js';
import { createRepository } from '../extension/data/repository.js';
import { createTrainingService } from '../extension/app/training.js';

function fixture(instant = '2026-10-04T10:00:00.000Z') {
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB });
  let current = instant;
  let calls = 0;
  const now = () => { calls += 1; return new Date(current); };
  const service = createTrainingService({ repository, now });
  return { repository, service, indexedDB, now, setTime: value => { current = value; }, calls: () => calls };
}

const snapshot = service => service.handle({ type: 'training.getSnapshot' });
const complete = (service, day, completed = true) => service.handle({ type: 'training.setCompletion', day, completed });
const exported = service => service.handle({ type: 'training.export' });

test('Bishkek midnight is 18:00 UTC independently of process timezone', () => {
  assert.equal(dayKey(new Date('2026-10-04T17:59:59.999Z'), 'Asia/Bishkek'), '2026-10-04');
  assert.equal(dayKey(new Date('2026-10-04T18:00:00.000Z'), 'Asia/Bishkek'), '2026-10-05');
});

test('day keys preserve four digit years for real calendar dates', () => {
  assert.equal(dayKey(new Date('0001-01-01T10:00:00.000Z'), 'UTC'), '0001-01-01');
});

test('valid leap dates and ISO offsets restore as canonical completion timestamps', async () => {
  const f = fixture();
  const backup = await exported(f.service);
  backup.state.program.startedOn = '2024-02-29';
  backup.state.days = [{ date: '2024-02-29', target: 10, completedAt: '2024-02-29T16:00:00+06:00' }];
  backup.exportedAt = '2026-10-04T16:00:00+06:00';
  const result = await f.service.handle({ type: 'training.import', backup });
  assert.equal(result.completedDays, 1);
  assert.equal((await f.repository.read()).days[0].completedAt, '2024-02-29T10:00:00.000Z');
});

test('first snapshot persists the fixed profile and schedules only dates since program start', async () => {
  const { service, repository, calls } = fixture();
  const result = await snapshot(service);
  assert.deepEqual(result.profile, { username: 'sebajun777', timeZone: 'Asia/Bishkek' });
  assert.deepEqual(result.program, { id: 'daily-puzzles', title: 'Ежедневная тактика', target: 10, startedOn: '2026-10-04' });
  assert.deepEqual(result.today, { date: '2026-10-04', taskId: 'puzzles', target: 10, completed: false, completedAt: null });
  assert.deepEqual(result.week.map(day => day.date), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(result.week.filter(day => day.scheduled).length, 1);
  assert.equal(result.completedDays, 0);
  assert.equal((await repository.read()).program.startedOn, '2026-10-04');
  assert.equal(calls(), 1);
});

test('completion retries keep the first timestamp and commands capture the clock once', async () => {
  const f = fixture();
  await snapshot(f.service);
  await complete(f.service, '2026-10-04');
  f.setTime('2026-10-04T12:00:00.000Z');
  const result = await complete(f.service, '2026-10-04');
  assert.equal(result.today.completedAt, '2026-10-04T10:00:00.000Z');
  assert.equal(result.completedDays, 1);
  assert.equal((await f.repository.read()).days.length, 1);
  assert.equal(f.calls(), 3);
});

test('stale page completion after midnight rejects without completing either day', async () => {
  const f = fixture('2026-10-04T17:59:59.999Z');
  await snapshot(f.service);
  const before = await f.repository.read();
  f.setTime('2026-10-04T18:00:00.000Z');
  await assert.rejects(complete(f.service, '2026-10-04'), /day|день|дат/i);
  assert.deepEqual(await f.repository.read(), before);
  assert.equal((await snapshot(f.service)).today.completed, false);
});

test('undo persists through service and repository recreation', async () => {
  const f = fixture();
  await complete(f.service, '2026-10-04');
  await complete(f.service, '2026-10-04', false);
  const reopened = createTrainingService({ repository: createRepository({ indexedDB: f.indexedDB }), now: f.now });
  const result = await snapshot(reopened);
  assert.equal(result.today.completedAt, null);
  assert.equal(result.today.completed, false);
  assert.equal(result.completedDays, 0);
});

test('simultaneous service writes preserve one daily record and the first completion', async () => {
  const f = fixture();
  const second = createTrainingService({ repository: createRepository({ indexedDB: f.indexedDB }), now: () => new Date('2026-10-04T12:00:00.000Z') });
  await Promise.all([complete(f.service, '2026-10-04'), complete(second, '2026-10-04')]);
  const state = await f.repository.read();
  assert.equal(state.days.length, 1);
  assert.equal(state.days[0].completedAt, '2026-10-04T10:00:00.000Z');
});

test('past completion remains visible when calendar advances without filling absent days', async () => {
  const f = fixture();
  await complete(f.service, '2026-10-04');
  f.setTime('2026-10-06T10:00:00.000Z');
  const result = await snapshot(f.service);
  assert.equal(result.today.completed, false);
  assert.equal(result.completedDays, 1);
  assert.deepEqual(result.week.slice(-3), [
    { date: '2026-10-04', scheduled: true, completed: true },
    { date: '2026-10-05', scheduled: true, completed: false },
    { date: '2026-10-06', scheduled: true, completed: false },
  ]);
});

test('backup export and validated replacement roundtrip with one clock capture each', async () => {
  const f = fixture();
  await complete(f.service, '2026-10-04');
  const backup = await exported(f.service);
  assert.equal(backup.format, 'lichess-training-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, '2026-10-04T10:00:00.000Z');
  await complete(f.service, '2026-10-04', false);
  const result = await f.service.handle({ type: 'training.import', backup });
  assert.equal(result.today.completed, true);
  assert.deepEqual(await f.repository.read(), backup.state);
  assert.equal(f.calls(), 4);
});

test('backup normalizes allowed fields instead of storing unknown properties', async () => {
  const f = fixture();
  await complete(f.service, '2026-10-04');
  const backup = await exported(f.service);
  backup.authentication = 'never stored';
  backup.state.extra = true;
  backup.state.profile.token = 'never stored';
  backup.state.program.extra = true;
  backup.state.program.title = 'Custom imported title';
  backup.state.days[0].extra = true;
  await f.service.handle({ type: 'training.import', backup });
  const state = await f.repository.read();
  assert.deepEqual(Object.keys(state).sort(), ['days', 'profile', 'program']);
  assert.deepEqual(Object.keys(state.profile).sort(), ['timeZone', 'username']);
  assert.deepEqual(Object.keys(state.program).sort(), ['id', 'startedOn', 'target', 'title']);
  assert.equal(state.program.title, 'Ежедневная тактика');
  assert.deepEqual(Object.keys(state.days[0]).sort(), ['completedAt', 'date', 'target']);
});

const invalidBackups = [
  ['future schema', b => { b.version = 2; }],
  ['wrong format', b => { b.format = 'other'; }],
  ['different account', b => { b.state.profile.username = 'someone'; }],
  ['different timezone', b => { b.state.profile.timeZone = 'UTC'; }],
  ['different program', b => { b.state.program.id = 'other'; }],
  ['invalid calendar date', b => { b.state.days[0].date = '2026-02-30'; }],
  ['invalid program start', b => { b.state.program.startedOn = '2026-02-30'; }],
  ['future program start', b => { b.state.program.startedOn = '2026-10-05'; }],
  ['duplicate day', b => { b.state.days.push({ ...b.state.days[0] }); }],
  ['day before start', b => { b.state.days[0] = { ...b.state.days[0], date: '2026-10-03', completedAt: null }; }],
  ['future day', b => { b.state.days[0] = { ...b.state.days[0], date: '2026-10-05', completedAt: null }; }],
  ['timestamp from another training day', b => { b.state.days[0].completedAt = '2026-10-04T18:00:00.000Z'; }],
  ['invalid completion timestamp', b => { b.state.days[0].completedAt = '2026-02-30T10:00:00.000Z'; }],
  ['invalid export timestamp', b => { b.exportedAt = 'not-a-date'; }],
  ['non ISO timestamp', b => { b.state.days[0].completedAt = 'October 4, 2026'; }],
  ['missing timestamp', b => { delete b.state.days[0].completedAt; }],
  ['zero target', b => { b.state.days[0].target = 0; }],
  ['excessive target', b => { b.state.days[0].target = 501; }],
  ['fractional target', b => { b.state.days[0].target = 10.5; }],
  ['zero program target', b => { b.state.program.target = 0; }],
  ['excessive program target', b => { b.state.program.target = 501; }],
  ['fractional program target', b => { b.state.program.target = 10.5; }],
  ['too many days', b => { b.state.days = Array.from({ length: 10001 }, () => ({ ...b.state.days[0] })); }],
  ['too large backup', b => { b.padding = 'x'.repeat(2 * 1024 * 1024); }],
];

test('import preserves allowed targets and uses the current day target ahead of the program default', async () => {
  const f = fixture();
  await complete(f.service, '2026-10-04');
  const backup = await exported(f.service);
  backup.state.program.target = 500;
  backup.state.days[0].target = 1;
  const restored = await f.service.handle({ type: 'training.import', backup });
  assert.equal(restored.today.target, 1);
  f.setTime('2026-10-05T10:00:00.000Z');
  const next = await snapshot(f.service);
  assert.equal(next.today.target, 500);
});

for (const [name, corrupt] of invalidBackups) {
  test(`import rejects ${name} without mutation`, async () => {
    const f = fixture();
    await complete(f.service, '2026-10-04');
    const before = await f.repository.read();
    const backup = await exported(f.service);
    corrupt(backup);
    await assert.rejects(f.service.handle({ type: 'training.import', backup }));
    assert.deepEqual(await f.repository.read(), before);
  });
}

test('malformed commands reject without changing the journal', async () => {
  const f = fixture();
  await snapshot(f.service);
  const before = await f.repository.read();
  for (const command of [null, {}, { type: 'other' }, { type: 'training.setCompletion', day: '2026-10-04', completed: 1 }, { type: 'training.import', backup: null }]) {
    await assert.rejects(f.service.handle(command));
    assert.deepEqual(await f.repository.read(), before);
  }
});

test('import rejects sparse days without replacing a working journal', async () => {
  const f = fixture();
  await complete(f.service, '2026-10-04');
  const before = await f.repository.read();
  const beforeExport = await exported(f.service);
  const backup = structuredClone(beforeExport);
  backup.state.days = new Array(1);
  await assert.rejects(f.service.handle({ type: 'training.import', backup }));
  assert.deepEqual(await f.repository.read(), before);
  assert.deepEqual(await exported(f.service), beforeExport);
  const result = await snapshot(f.service);
  assert.equal(result.today.completed, true);
  assert.equal(result.today.completedAt, '2026-10-04T10:00:00.000Z');
});
