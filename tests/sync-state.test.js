import test from 'node:test';
import assert from 'node:assert/strict';
import { getSyncState, parseLivePage, advanceSyncState, buildSyncSnapshot } from '../extension/core/sync-state.js';

const instant = new Date('2026-10-06T06:00:00Z');
const since = Date.parse('2026-10-05T00:00:00Z');
const until = instant.getTime();
const raw = (id = 'abcdefgh', createdAt = since + 1) => ({ id, createdAt, lastMoveAt: createdAt + 1,
  rated: true, variant: 'standard', speed: 'bullet', status: 'mate', winner: 'white',
  players: { white: { user: { id: 'sebajun777' }, rating: 2100, ratingDiff: 5 },
    black: { user: { id: 'opponent' }, rating: 2000, ratingDiff: -5 } }, moves: 'e4 e5' });
const empty = () => ({ games: [], ratings: [], meta: null, sync: null });

test('first sync covers seven days before known history or thirty days without history', () => {
  assert.equal(getSyncState(empty(), instant).coverageStart, until - 30 * 86400000);
  const history = { ...empty(), games: [{ createdAt: since - 100 }, { createdAt: since }] };
  const state = getSyncState(history, instant);
  assert.equal(state.coverageStart, since - 7 * 86400000);
  assert.equal(state.revision, 0);
  assert.equal(state.completedUntil, null);
  assert.equal(state.cycleUntil, null);
});

test('stored coverage remains fixed even after new games or source import', () => {
  const sync = { ...getSyncState(empty(), instant), revision: 1 };
  assert.deepEqual(getSyncState({ ...empty(), games: [{ createdAt: until + 100 }], sync }, instant), sync);
});

test('API pagination counts skipped AI, casual and ongoing records without needing opponent users', () => {
  const casual = { ...raw('casual01', since + 2), rated: false, players: { white: { user: { id: 'sebajun777' } }, black: { aiLevel: 4 } } };
  const started = { ...raw('pending1', since + 3), status: 'started' };
  const records = [raw(), casual, started];
  const parsed = parseLivePage({ records, rows: 3 }, { since, until });
  assert.equal(parsed.games.length, 1);
  assert.equal(parsed.games[0].id, 'abcdefgh');
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.lastCreatedAt, since + 3);
});

test('an empty successful page is valid and duplicate completed IDs are counted once', () => {
  assert.deepEqual(parseLivePage({ records: [], rows: 0 }, { since, until }), { games: [], skipped: 0, lastCreatedAt: null });
  const parsed = parseLivePage({ records: [raw(), raw()], rows: 2 }, { since, until });
  assert.equal(parsed.games.length, 1);
});

test('bad ordering, out-of-window times, wrong profile, inconsistent rows and conflicting IDs reject the page', () => {
  const other = raw();
  other.players.white.user.id = 'someoneelse';
  const changed = { ...raw(), winner: 'black' };
  for (const records of [[raw('firstone', since + 2), raw('secondid', since + 1)],
    [raw('firstone', since - 1)], [raw('firstone', until)], [other], [raw(), changed],
    [{ ...raw(), id: 'bad' }], [{ ...raw(), createdAt: NaN }], [{ ...raw(), rated: 'yes' }]]) {
    assert.throws(() => parseLivePage({ records, rows: records.length }, { since, until }));
  }
  assert.throws(() => parseLivePage({ records: [raw()], rows: 0 }, { since, until }));
});

test('a full page keeps the exclusive upper bound frozen and resumes with inclusive last time', () => {
  const state = getSyncState(empty(), instant);
  const next = advanceSyncState(state, { since: state.coverageStart, until, rows: 200, lastCreatedAt: since }, instant);
  assert.equal(next.cycleUntil, until);
  assert.equal(next.nextSince, since);
  assert.equal(next.completedUntil, null);
  assert.equal(next.lastSuccessAt, null);
  assert.equal(next.revision, 1);
});

test('a short or empty page completes only its frozen cycle and leaves original floor for next scan', () => {
  const state = { ...getSyncState(empty(), instant), revision: 1, cycleUntil: until - 1000, nextSince: since };
  for (const rows of [0, 1]) {
    const next = advanceSyncState(state, { since, until: state.cycleUntil, rows, lastCreatedAt: rows ? since : null }, instant);
    assert.equal(next.cycleUntil, null);
    assert.equal(next.nextSince, null);
    assert.equal(next.completedUntil, until - 1000);
    assert.equal(next.lastSuccessAt, instant.toISOString());
    assert.equal(next.coverageStart, state.coverageStart);
    assert.equal(next.revision, 2);
  }
});

test('saturated equal timestamps cannot advance or announce completed coverage', () => {
  const state = getSyncState(empty(), instant);
  assert.throws(() => advanceSyncState(state, { since, until, rows: 200, lastCreatedAt: since }, instant), /продвин|одинаков/i);
});

test('today counts the Bishkek start date, separately per control and without adding training marks', () => {
  const own = parseLivePage({ records: [raw('oldgame1', Date.parse('2026-10-05T17:59:59Z')),
    raw('today001', Date.parse('2026-10-05T18:00:00Z')),
    { ...raw('today002', Date.parse('2026-10-06T05:00:00Z')), speed: 'blitz' }], rows: 3 }, { since, until });
  const snapshot = buildSyncSnapshot({ ...empty(), games: own.games }, instant, true);
  assert.equal(snapshot.today.date, '2026-10-06');
  assert.deepEqual(snapshot.today.groups, [{ speed: 'bullet', games: 1 }, { speed: 'blitz', games: 1 }, { speed: 'rapid', games: 0 }]);
  assert.equal(snapshot.overview.totalGames, 3);
  assert.equal(snapshot.permissionGranted, true);
});
