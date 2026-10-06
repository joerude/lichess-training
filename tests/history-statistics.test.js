import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryOverview } from '../extension/core/history-statistics.js';

const instant = Date.parse('2026-03-01T17:59:00Z');
function game(id, speed, result, createdAt, rating = null, ratingDiff = null, analysed = false) {
  return { id, username: 'sebajun777', speed, result, createdAt, lastMoveAt: createdAt + 1000,
    rated: true, variant: 'standard', status: 'mate', color: 'white', rating, ratingDiff,
    analysed, opponent: { id: 'opponent', name: 'Opponent', rating: null }, moves: '', opening: null, playerAnalysis: null };
}

test('empty overview keeps all speed groups with unknown ratings and dates', () => {
  assert.deepEqual(buildHistoryOverview({ games: [], ratings: [], meta: null }), {
    totalGames: 0, firstGameAt: null, lastGameAt: null, importedAt: null, sourceName: null,
    groups: ['bullet', 'blitz', 'rapid'].map(speed => ({ speed, games: 0, wins: 0, losses: 0, draws: 0, analysed: 0, winRate: null, lastRating: null, ratingDate: null })),
    ratings: [],
  });
});

test('overview derives hand counted outcomes, creation range and per-speed ratings', () => {
  const games = [
    game('Third123', 'bullet', 'draw', instant + 120000, 2100, 0, true),
    game('First123', 'bullet', 'win', instant, 2000, 10, true),
    game('Blitz123', 'blitz', 'loss', instant + 60000, 1800, -5),
    game('Second12', 'bullet', 'loss', instant + 30000, 2110, -10),
    game('Rapid123', 'rapid', 'win', instant + 180000),
  ];
  const overview = buildHistoryOverview({ games, ratings: [], meta: { importedAt: '2026-10-04T00:00:00Z', sourceName: 'games.ndjson', secret: 'omit' } });
  assert.equal(overview.totalGames, 5);
  assert.equal(overview.firstGameAt, instant);
  assert.equal(overview.lastGameAt, instant + 180000);
  assert.equal(overview.importedAt, '2026-10-04T00:00:00Z');
  assert.equal(overview.sourceName, 'games.ndjson');
  assert.deepEqual(overview.groups, [
    { speed: 'bullet', games: 3, wins: 1, losses: 1, draws: 1, analysed: 2, winRate: 33.33333333333333, lastRating: 2100, ratingDate: '2026-03-02' },
    { speed: 'blitz', games: 1, wins: 0, losses: 1, draws: 0, analysed: 0, winRate: 0, lastRating: 1795, ratingDate: '2026-03-02' },
    { speed: 'rapid', games: 1, wins: 1, losses: 0, draws: 0, analysed: 0, winRate: 100, lastRating: null, ratingDate: null },
  ]);
  assert.deepEqual(overview.ratings, [
    { name: 'Bullet', points: [{ date: '2026-03-01', rating: 2100 }, { date: '2026-03-02', rating: 2100 }] },
    { name: 'Blitz', points: [{ date: '2026-03-02', rating: 1795 }] },
  ]);
  assert.deepEqual(buildHistoryOverview({ games: [...games].reverse(), ratings: [], meta: { importedAt: '2026-10-04T00:00:00Z', sourceName: 'games.ndjson' } }), overview);
});

test('supplied daily series take precedence and puzzles remain separate', () => {
  const games = [game('Bullet12', 'bullet', 'win', instant, 2000, 5), game('Blitz123', 'blitz', 'draw', instant, 1700, 0)];
  const ratings = [
    { name: 'Puzzles', points: [{ date: '2026-03-03', rating: 2500 }] },
    { name: 'Bullet', points: [{ date: '2026-03-01', rating: 1999 }] },
    { name: 'Blitz', points: [] },
  ];
  const result = buildHistoryOverview({ games, ratings, meta: {} });
  assert.deepEqual(result.ratings, [
    { name: 'Bullet', points: [{ date: '2026-03-01', rating: 1999 }] },
    { name: 'Blitz', points: [{ date: '2026-03-01', rating: 1700 }] },
    { name: 'Puzzles', points: [{ date: '2026-03-03', rating: 2500 }] },
  ]);
  assert.equal(result.groups[0].lastRating, 2005);
  assert.equal(result.totalGames, 2);
});

test('latest exact postgame rating retains its own date when later ratings are unknown', () => {
  const result = buildHistoryOverview({ games: [
    game('Known123', 'bullet', 'win', instant, 2000, 0),
    game('NoDiff12', 'bullet', 'draw', instant + 60000, 2100, null),
    game('NoRate12', 'bullet', 'loss', instant + 120000, null, -5),
  ], ratings: [], meta: null });
  assert.equal(result.groups[0].lastRating, 2000);
  assert.equal(result.groups[0].ratingDate, '2026-03-01');
  assert.deepEqual(result.ratings, [{ name: 'Bullet', points: [{ date: '2026-03-01', rating: 2000 }] }]);
});

test('same-time games choose deterministic daily rating independently of input order', () => {
  const games = [game('Aaaaaaaa', 'bullet', 'win', instant, 2000, 1), game('Zzzzzzzz', 'bullet', 'win', instant, 2100, 2)];
  const forward = buildHistoryOverview({ games, ratings: [], meta: null });
  const reverse = buildHistoryOverview({ games: [...games].reverse(), ratings: [], meta: null });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.groups[0].lastRating, 2102);
});

test('new game dates extend imported rating series without replacing supplied days or puzzles', () => {
  const ratings = [
    { name: 'Bullet', points: [{ date: '2026-03-01', rating: 1999 }] },
    { name: 'Puzzles', points: [{ date: '2026-03-01', rating: 1726 }] },
  ];
  const result = buildHistoryOverview({ games: [
    game('SameDay1', 'bullet', 'win', instant, 2000, 5),
    game('NextDay1', 'bullet', 'win', instant + 120000, 2005, 6),
    game('NextDay2', 'bullet', 'win', instant + 180000, 2011, 7),
  ], ratings, meta: null });
  assert.deepEqual(result.ratings, [
    { name: 'Bullet', points: [{ date: '2026-03-01', rating: 1999 }, { date: '2026-03-02', rating: 2018 }] },
    { name: 'Puzzles', points: [{ date: '2026-03-01', rating: 1726 }] },
  ]);
  assert.equal(ratings[0].points.length, 1);
});
