import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfile, setActiveProfile, clearActiveProfile, hasActiveProfile, activeProfile, dayStart,
} from '../extension/core/profile.js';
import { dayKey, trainingDay, initialState, normalizeBackup, backupFrom } from '../extension/core/training-engine.js';
import { practiceSnapshot } from '../extension/core/practice-engine.js';
import { parseLivePage } from '../extension/core/sync-state.js';
import { normalizeGame } from '../extension/data/normalize-game.js';
import { parseDataset } from '../extension/data/dataset-import.js';
import { createHistoryService } from '../extension/app/history.js';

// tests/setup.js gives every test file this profile; the tests below switch it and always switch it back.
const SUITE_PROFILE = { username: 'sebajun777', timeZone: 'Asia/Bishkek' };
const NEW_YORK = { username: 'magnus_fan', timeZone: 'America/New_York' };
const USERNAME_ERROR = 'Логин Lichess: 2–30 символов, латинские буквы, цифры, «_» и «-».';
const ZONE_ERROR = 'Неизвестный часовой пояс.';
const PROFILE_MISMATCH = 'Резервная копия принадлежит другому профилю, часовому поясу или программе.';
const LOGIN_MISSING = 'Не указан логин Lichess.';
const HOUR = 3600000;

// Restores whatever was active before, so calls can nest and the suite profile is back when a test ends.
function withProfile(profile, run) {
  const previous = activeProfile();
  setActiveProfile(profile);
  try { return run(); } finally { setActiveProfile(previous); }
}

test('normalizeProfile trims and lowercases the login and keeps only profile fields', () => {
  assert.deepEqual(normalizeProfile({ username: '  Magnus_Fan ', timeZone: 'America/New_York' }), NEW_YORK);
  assert.deepEqual(normalizeProfile({ ...SUITE_PROFILE, extra: true }), SUITE_PROFILE);
});

test('normalizeProfile stores the time zone in its canonical spelling', () => {
  for (const [typed, canonical] of [
    ['asia/bishkek', 'Asia/Bishkek'], ['AMERICA/NEW_YORK', 'America/New_York'], ['utc', 'UTC'], ['Europe/London', 'Europe/London'],
  ]) {
    assert.equal(normalizeProfile({ username: 'magnus_fan', timeZone: typed }).timeZone, canonical);
  }
  try {
    assert.deepEqual(setActiveProfile({ username: 'magnus_fan', timeZone: 'america/new_york' }), NEW_YORK);
    assert.deepEqual(activeProfile(), NEW_YORK);
  } finally {
    setActiveProfile(SUITE_PROFILE);
  }
});

test('normalizeProfile accepts logins of 2 to 30 characters', () => {
  for (const username of ['ab', 'a1', 'a-b_c', 'A'.repeat(30), `9${'_'.repeat(28)}z`, 'sebajun777']) {
    assert.equal(normalizeProfile({ username, timeZone: 'UTC' }).username, username.toLowerCase());
  }
});

for (const [name, username] of [
  ['one character', 'a'], ['empty', ''], ['blank', '   '], ['leading hyphen', '-bad'], ['trailing hyphen', 'bad-'],
  ['leading underscore', '_bad'], ['trailing underscore', 'bad_'], ['cyrillic', 'имя'], ['inner space', 'bad name'],
  ['31 characters', 'a'.repeat(31)], ['punctuation', 'bad!name'], ['slash', 'a/b'],
  ['number', 42], ['null', null], ['missing', undefined],
]) {
  test(`normalizeProfile rejects a login: ${name}`, () => {
    assert.throws(() => normalizeProfile({ username, timeZone: 'UTC' }), { message: USERNAME_ERROR });
  });
}

for (const [name, timeZone] of [
  ['empty', ''], ['unknown', 'Mars/Olympus'], ['padded', ' Asia/Bishkek'], ['number', 5], ['null', null], ['missing', undefined],
]) {
  test(`normalizeProfile rejects a time zone: ${name}`, () => {
    assert.throws(() => normalizeProfile({ username: 'magnus_fan', timeZone }), { message: ZONE_ERROR });
  });
}

test('normalizeProfile rejects anything that is not an object', () => {
  for (const input of [null, undefined, 'sebajun777', 42, true, []]) {
    assert.throws(() => normalizeProfile(input), { message: 'Некорректный профиль.' });
  }
});

test('activeProfile requires a profile, can be cleared and hands out copies', () => {
  try {
    clearActiveProfile();
    assert.equal(hasActiveProfile(), false);
    assert.throws(() => activeProfile(), { message: 'Сначала укажите свой логин Lichess.', code: 'profile-required' });
    const input = { username: ' Magnus_Fan ', timeZone: 'America/New_York' };
    setActiveProfile(input);
    input.username = 'someone_else';
    assert.equal(hasActiveProfile(), true);
    assert.deepEqual(activeProfile(), NEW_YORK);
    activeProfile().username = 'tampered';
    assert.deepEqual(activeProfile(), NEW_YORK);
    clearActiveProfile();
    assert.equal(hasActiveProfile(), false);
    assert.throws(() => activeProfile(), { code: 'profile-required' });
  } finally {
    setActiveProfile(SUITE_PROFILE);
  }
  assert.deepEqual(activeProfile(), SUITE_PROFILE);
});

test('an invalid profile is rejected without replacing the active one', () => {
  assert.throws(() => setActiveProfile({ username: 'x', timeZone: 'UTC' }), { message: USERNAME_ERROR });
  assert.throws(() => setActiveProfile({ username: 'magnus_fan', timeZone: 'Mars/Olympus' }), { message: ZONE_ERROR });
  assert.throws(() => setActiveProfile(null), { message: 'Некорректный профиль.' });
  assert.deepEqual(activeProfile(), SUITE_PROFILE);
});

test('dayStart in Bishkek equals the former fixed +06:00 midnight', () => {
  for (const day of ['2024-02-29', '2026-01-01', '2026-06-30', '2026-10-06', '2026-12-31']) {
    assert.equal(dayStart(day, 'Asia/Bishkek'), Date.parse(`${day}T00:00:00.000+06:00`));
  }
});

test('dayStart follows the New York daylight saving transitions', () => {
  const zone = 'America/New_York';
  assert.equal(dayStart('2026-03-08', zone), Date.parse('2026-03-08T00:00:00.000-05:00'));
  assert.equal(dayStart('2026-03-09', zone), Date.parse('2026-03-09T00:00:00.000-04:00'));
  assert.equal(dayStart('2026-07-01', zone), Date.parse('2026-07-01T00:00:00.000-04:00'));
  assert.equal(dayStart('2026-11-01', zone), Date.parse('2026-11-01T00:00:00.000-04:00'));
  assert.equal(dayStart('2026-11-02', zone), Date.parse('2026-11-02T00:00:00.000-05:00'));
  assert.equal(dayStart('2026-03-09', zone) - dayStart('2026-03-08', zone), 23 * HOUR);
  assert.equal(dayStart('2026-11-02', zone) - dayStart('2026-11-01', zone), 25 * HOUR);
});

test('dayStart handles the farthest offsets, partial hours and UTC', () => {
  assert.equal(dayStart('2026-10-13', 'Pacific/Kiritimati'), Date.parse('2026-10-13T00:00:00.000+14:00'));
  assert.equal(dayStart('2026-10-13', 'Pacific/Pago_Pago'), Date.parse('2026-10-13T00:00:00.000-11:00'));
  assert.equal(dayStart('2026-10-13', 'Asia/Kolkata'), Date.parse('2026-10-13T00:00:00.000+05:30'));
  assert.equal(dayStart('2026-10-13', 'Asia/Kathmandu'), Date.parse('2026-10-13T00:00:00.000+05:45'));
  assert.equal(dayStart('2026-10-13', 'UTC'), Date.parse('2026-10-13T00:00:00.000Z'));
  assert.equal(dayStart('0001-01-01', 'UTC'), Date.parse('0001-01-01T00:00:00.000Z'));
  assert.equal(dayStart('9999-12-31', 'UTC'), Date.parse('9999-12-31T00:00:00.000Z'));
});

test('dayStart starts the day after the clock skips local midnight', () => {
  // Lebanon moved the clock from 00:00 straight to 01:00, so 2020-03-29 began at 01:00 (+03:00).
  assert.equal(dayStart('2020-03-29', 'Asia/Beirut'), Date.parse('2020-03-29T01:00:00.000+03:00'));
  // Brazil did the same on 2018-11-04.
  assert.equal(dayStart('2018-11-04', 'America/Sao_Paulo'), Date.parse('2018-11-04T01:00:00.000-02:00'));
});

// Whatever the zone rules are, the day key must flip exactly at the returned instant.
for (const [zone, day] of [
  ['Asia/Bishkek', '2026-10-13'], ['America/New_York', '2026-03-08'], ['America/New_York', '2026-11-01'],
  ['Pacific/Kiritimati', '2026-10-13'], ['Pacific/Pago_Pago', '2026-10-13'], ['Asia/Kathmandu', '2026-10-13'],
  ['Australia/Lord_Howe', '2026-10-04'], ['Australia/Lord_Howe', '2026-04-05'], ['Europe/London', '2026-03-29'],
  ['Europe/London', '2026-10-25'], ['Asia/Beirut', '2020-03-29'], ['America/Sao_Paulo', '2018-11-04'],
  ['America/Sao_Paulo', '2018-02-18'], ['Pacific/Apia', '2011-12-31'], ['+06:00', '2026-10-13'], ['UTC', '2024-02-29'],
]) {
  test(`dayStart is the first instant of ${day} in ${zone}`, () => {
    const start = dayStart(day, zone);
    assert.equal(dayKey(new Date(start), zone), day);
    assert.ok(dayKey(new Date(start - 1), zone) < day);
  });
}

test('dayStart rejects malformed days and unknown time zones', () => {
  for (const day of ['2026-02-30', '2026-13-01', '26-10-13', '0000-01-01', '', null, undefined, 20261013]) {
    assert.throws(() => dayStart(day, 'UTC'), /день/i);
  }
  for (const zone of ['', 'Mars/Olympus', undefined, null]) {
    assert.throws(() => dayStart('2026-10-13', zone), { message: ZONE_ERROR });
  }
});

test('trainingDay follows the time zone of the active profile', () => {
  const instant = new Date('2026-10-13T03:30:00.000Z');
  assert.equal(trainingDay(instant), '2026-10-13');
  assert.equal(withProfile(NEW_YORK, () => trainingDay(instant)), '2026-10-12');
  assert.equal(trainingDay(instant), '2026-10-13');
});

test('initialState writes the active profile', () => {
  const state = withProfile(NEW_YORK, () => initialState('2026-10-12'));
  assert.deepEqual(state.profile, NEW_YORK);
  state.profile.username = 'tampered';
  assert.deepEqual(initialState('2026-10-13').profile, SUITE_PROFILE);
  assert.deepEqual(withProfile(NEW_YORK, () => activeProfile()), NEW_YORK);
});

test('a backup restores only into the profile that exported it', () => {
  const today = '2026-10-12';
  const backup = withProfile(NEW_YORK, () => backupFrom(initialState(today), new Date('2026-10-12T12:00:00.000Z')));
  assert.deepEqual(withProfile(NEW_YORK, () => normalizeBackup(backup, today)).profile, NEW_YORK);
  for (const profile of [SUITE_PROFILE, { ...NEW_YORK, username: 'someone_else' }, { ...NEW_YORK, timeZone: 'Europe/London' }]) {
    assert.throws(() => withProfile(profile, () => normalizeBackup(backup, today)),
      { message: `Копия для magnus_fan · America/New_York, а журнал — для ${profile.username} · ${profile.timeZone}. Укажите тот же профиль или смените его в разделе «Профиль».` });
  }
  assert.throws(() => withProfile(NEW_YORK, () => normalizeBackup({ ...backup, state: { ...backup.state, program: { ...backup.state.program, id: 'other' } } }, today)), { message: PROFILE_MISMATCH });
});

test('backup completion times belong to the day of the profile time zone', () => {
  const today = '2026-10-12';
  const completedAt = '2026-10-13T03:30:00.000Z';
  const exportedAt = new Date('2026-10-13T04:00:00.000Z');
  const backup = profile => withProfile(profile, () => backupFrom({ ...initialState(today), days: [{ date: today, target: 10, completedAt }] }, exportedAt));
  assert.equal(withProfile(NEW_YORK, () => normalizeBackup(backup(NEW_YORK), today)).days[0].completedAt, completedAt);
  assert.throws(() => normalizeBackup(backup(SUITE_PROFILE), today), /не соответствует/);
});

const bulletGame = (id, username, createdAt) => ({
  id, username, speed: 'bullet', createdAt, lastMoveAt: createdAt + 120000,
  status: 'mate', rated: true, variant: 'standard', color: 'white', result: 'win', analysed: false,
});
const snapshotOf = (games, today, sync = null) => practiceSnapshot({ journal: null, practice: null, games, sync }, today);
const bulletOf = view => view.tasks.find(task => task.id === 'bullet').current;

test('practice counts the games of the active login and ignores other accounts', () => {
  const today = '2026-10-12';
  const at = Date.parse('2026-10-12T15:00:00Z');
  const games = [bulletGame('mine0001', 'magnus_fan', at), bulletGame('theirs01', 'sebajun777', at + 1000)];
  const asNewYork = withProfile(NEW_YORK, () => snapshotOf(games, today));
  assert.deepEqual(asNewYork.reviewOptions.map(option => option.id), ['mine0001']);
  assert.equal(bulletOf(asNewYork), 1);
  assert.deepEqual(asNewYork.profile, NEW_YORK);
  const asSuite = snapshotOf(games, today);
  assert.deepEqual(asSuite.reviewOptions.map(option => option.id), ['theirs01']);
  assert.equal(bulletOf(asSuite), 1);
});

test('practice days follow the time zone of the profile', () => {
  // 03:30 UTC on 13 October is still the evening of the 12th in New York but already the 13th in Bishkek.
  const instant = Date.parse('2026-10-13T03:30:00Z');
  const games = [bulletGame('nyc00001', 'magnus_fan', instant), bulletGame('bsh00001', 'sebajun777', instant)];
  const newYork = withProfile(NEW_YORK, () => snapshotOf(games, '2026-10-12'));
  assert.equal(bulletOf(newYork), 1);
  assert.deepEqual(newYork.reviewOptions.map(option => option.id), ['nyc00001']);
  const bishkekEve = snapshotOf(games, '2026-10-12');
  assert.equal(bulletOf(bishkekEve), 0);
  assert.deepEqual(bishkekEve.reviewOptions, []);
  assert.equal(bulletOf(snapshotOf(games, '2026-10-13')), 1);
});

test('coverage is measured from local midnight in the profile time zone', () => {
  const today = '2026-10-12';
  const partial = completedUntil => snapshotOf([], today, { coverageStart: 0, cycleUntil: null, completedUntil }).coverage.partial;
  const newYorkMidnight = Date.parse('2026-10-12T00:00:00.000-04:00');
  const bishkekMidnight = Date.parse('2026-10-12T00:00:00.000+06:00');
  withProfile(NEW_YORK, () => {
    assert.equal(partial(newYorkMidnight), false);
    assert.equal(partial(newYorkMidnight - 1), true);
    assert.equal(partial(bishkekMidnight), true);
  });
  assert.equal(partial(bishkekMidnight), false);
  assert.equal(partial(bishkekMidnight - 1), true);
  assert.equal(partial(newYorkMidnight), false);
});

const rawGame = (login, overrides = {}) => ({
  id: 'abcdefgh', rated: true, variant: 'standard', speed: 'bullet', status: 'mate', winner: 'white',
  createdAt: Date.parse('2026-10-05T10:00:00Z'), lastMoveAt: Date.parse('2026-10-05T10:01:00Z'),
  players: { white: { user: { id: login.toLowerCase(), name: login }, rating: 2100, ratingDiff: 5 },
    black: { user: { id: 'opponent', name: 'Opponent' }, rating: 2000, ratingDiff: -5 } },
  moves: 'e4 e5', ...overrides,
});

test('game parsing needs the login explicitly and compares it without case', () => {
  const raw = rawGame('Magnus_Fan');
  const dataset = JSON.stringify(raw);
  for (const login of [undefined, '', '  ', null, 42]) {
    assert.throws(() => normalizeGame(raw, login), { message: LOGIN_MISSING });
  }
  assert.throws(() => normalizeGame(raw), { message: LOGIN_MISSING });
  assert.throws(() => parseDataset(dataset), { message: LOGIN_MISSING });
  assert.throws(() => parseDataset(dataset, null), { message: LOGIN_MISSING });
  assert.equal(normalizeGame(raw, 'MAGNUS_FAN').username, 'magnus_fan');
  assert.equal(normalizeGame({ ...raw, players: { ...raw.players, white: { user: { name: 'Magnus_Fan' } } } }, 'magnus_fan').color, 'white');
  assert.equal(parseDataset(dataset, null, 'Magnus_Fan').games[0].username, 'magnus_fan');
  assert.throws(() => normalizeGame(raw, 'sebajun777'), /профил/i);
  assert.throws(() => parseDataset(dataset, null, 'sebajun777'), /профил/i);
});

test('live pages are matched to the login of the active profile', () => {
  const since = Date.parse('2026-10-05T00:00:00Z');
  const until = Date.parse('2026-10-06T06:00:00Z');
  const page = { records: [rawGame('Magnus_Fan')], rows: 1 };
  assert.equal(withProfile(NEW_YORK, () => parseLivePage(page, { since, until })).games[0].username, 'magnus_fan');
  assert.throws(() => parseLivePage(page, { since, until }), /профил/i);
  try {
    clearActiveProfile();
    assert.throws(() => parseLivePage(page, { since, until }), { message: 'Сначала укажите свой логин Lichess.', code: 'profile-required' });
  } finally {
    setActiveProfile(SUITE_PROFILE);
  }
});

test('history files are parsed for the login of the active profile', async () => {
  const history = createHistoryService({ repository: {} });
  const command = { type: 'history.previewImport', gamesText: JSON.stringify(rawGame('Magnus_Fan')) };
  try {
    setActiveProfile(NEW_YORK);
    assert.equal((await history.handle(command)).unique, 1);
    setActiveProfile(SUITE_PROFILE);
    await assert.rejects(history.handle(command), /профил/i);
  } finally {
    setActiveProfile(SUITE_PROFILE);
  }
});
