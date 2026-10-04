import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGame } from '../extension/data/normalize-game.js';
import { parseDataset, normalizeRatingHistory } from '../extension/data/dataset-import.js';

function game(overrides = {}) {
  return {
    id: 'Abcd1234', rated: true, variant: 'standard', speed: 'bullet',
    createdAt: 1000, lastMoveAt: 2000, status: 'mate', winner: 'white',
    players: {
      white: { user: { id: 'sebajun777', name: 'Sebajun777' }, rating: 2000, ratingDiff: 0 },
      black: { user: { id: 'opponent', name: 'Opponent' }, rating: 1900, ratingDiff: -5 },
    }, moves: 'e4 e5', ...overrides,
  };
}
const text = records => records.map(record => JSON.stringify(record)).join('\n');

test('normalization keeps compact own analysis and a known zero rating change', () => {
  const raw = game({ opening: { eco: 'C20', name: 'King’s Pawn Game', ply: 2 }, clocks: [50], analysis: [{ eval: 1 }] });
  raw.players.white.analysis = { acpl: 12, inaccuracy: 2, mistake: 0, blunder: 1, extra: true };
  assert.deepEqual(normalizeGame(raw), {
    id: 'Abcd1234', username: 'sebajun777', speed: 'bullet', createdAt: 1000, lastMoveAt: 2000,
    status: 'mate', rated: true, variant: 'standard', color: 'white', result: 'win',
    rating: 2000, ratingDiff: 0, opponent: { id: 'opponent', name: 'Opponent', rating: 1900 },
    opening: { eco: 'C20', name: 'King’s Pawn Game' }, moves: 'e4 e5', analysed: true,
    playerAnalysis: { acpl: 12, inaccuracy: 2, mistake: 0, blunder: 1 },
  });
});

test('profile matching is case insensitive and can fall back to name', () => {
  const raw = game();
  raw.players.white.user = { name: 'SEBAJUN777' };
  assert.equal(normalizeGame(raw).color, 'white');
  raw.players.white.user = { id: 'another-user', name: 'sebajun777' };
  assert.throws(() => normalizeGame(raw), /profile|account|профил/i);
});

test('black player outcomes and missing winner on finished games are normalized', () => {
  const raw = game();
  [raw.players.white, raw.players.black] = [raw.players.black, raw.players.white];
  assert.equal(normalizeGame(raw).result, 'loss');
  raw.winner = 'black';
  assert.equal(normalizeGame(raw).result, 'win');
  delete raw.winner;
  assert.equal(normalizeGame(raw).result, 'draw');
});

test('all known finished statuses without a winner are draws', () => {
  for (const status of ['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd', 'unknownFinish']) {
    const raw = game({ status });
    delete raw.winner;
    assert.equal(normalizeGame(raw).result, 'draw', status);
  }
});

test('casual, variant, other speeds and pending games are skipped', () => {
  for (const overrides of [{ rated: false }, { variant: 'chess960' }, { speed: 'classical' }, { status: 'started' }, { status: 'created' }, { status: 'aborted' }]) {
    assert.equal(normalizeGame(game(overrides)), null);
  }
});

test('missing optional ratings and analysis stay unknown', () => {
  const raw = game();
  raw.players.white = { user: { id: 'sebajun777' }, analysis: { mistake: 0 } };
  raw.players.black = { user: { name: 'Opponent' } };
  delete raw.moves;
  const normalized = normalizeGame(raw);
  assert.equal(normalized.rating, null);
  assert.equal(normalized.ratingDiff, null);
  assert.equal(normalized.opponent.rating, null);
  assert.equal(normalized.moves, '');
  assert.equal(normalized.analysed, true);
  assert.deepEqual(normalized.playerAnalysis, { acpl: null, inaccuracy: null, mistake: 0, blunder: null });
});

const malformed = [
  ['nonobject', () => null],
  ['invalid ID', raw => ({ ...raw, id: 'short' })],
  ['invalid ID characters', raw => ({ ...raw, id: 'Abcd12_4' })],
  ['wrong profile', raw => { raw.players.white.user.id = 'someone'; return raw; }],
  ['missing players', raw => ({ ...raw, players: {} })],
  ['nonboolean rated', raw => ({ ...raw, rated: 'true' })],
  ['nonfinite createdAt', raw => ({ ...raw, createdAt: Infinity })],
  ['nonfinite lastMoveAt', raw => ({ ...raw, lastMoveAt: NaN })],
  ['unsafe timestamp', raw => ({ ...raw, createdAt: Number.MAX_SAFE_INTEGER + 1 })],
  ['negative timestamp', raw => ({ ...raw, createdAt: -1 })],
  ['fractional timestamp', raw => ({ ...raw, createdAt: 1.5 })],
  ['reversed timestamps', raw => ({ ...raw, lastMoveAt: 0 })],
  ['invalid winner', raw => ({ ...raw, winner: 'red' })],
  ['null winner', raw => ({ ...raw, winner: null })],
  ['nonstring moves', raw => ({ ...raw, moves: [] })],
  ['invalid opening', raw => ({ ...raw, opening: { eco: 20, name: 'Opening' } })],
  ['invalid own rating', raw => { raw.players.white.rating = 0; return raw; }],
  ['fractional rating difference', raw => { raw.players.white.ratingDiff = 0.5; return raw; }],
  ['invalid aggregate count', raw => { raw.players.white.analysis = { blunder: -1 }; return raw; }],
  ['nonfinite aggregate', raw => { raw.players.white.analysis = { acpl: Infinity }; return raw; }],
];
for (const [name, corrupt] of malformed) {
  test(`normalization rejects ${name}`, () => assert.throws(() => normalizeGame(corrupt(game()))));
}

test('timestamps must be representable dates as well as nonnegative safe integers', () => {
  const maximumDate = 8640000000000000;
  assert.throws(() => normalizeGame(game({ createdAt: maximumDate + 1, lastMoveAt: maximumDate + 1 })));
  assert.throws(() => normalizeGame(game({ lastMoveAt: maximumDate + 1 })));
});

test('both timestamps must keep Bishkek calendar dates within four-digit years', () => {
  const lastSupported = Date.parse('9999-12-31T17:59:59.999Z');
  assert.equal(normalizeGame(game({ createdAt: lastSupported, lastMoveAt: lastSupported })).createdAt, lastSupported);
  for (const timestamp of [lastSupported + 1, Date.parse('+010000-01-01T00:00:00.000Z')]) {
    assert.throws(() => normalizeGame(game({ createdAt: timestamp, lastMoveAt: timestamp })), /createdAt/);
    assert.throws(() => normalizeGame(game({ lastMoveAt: timestamp })), /lastMoveAt/);
  }
});

test('preview counts rows, skips and duplicates and reports creation chronology', () => {
  const first = game({ id: 'First123', createdAt: 10, lastMoveAt: 100 });
  const last = game({ id: 'Last1234', createdAt: 300, lastMoveAt: 400 });
  const input = `\n${text([last, game({ rated: false }), first, first])}\n\n`;
  const result = parseDataset(input);
  assert.equal(result.games.length, 2);
  assert.equal(result.ratings, null);
  assert.deepEqual(result.report, { rows: 4, unique: 2, duplicates: 1, skipped: 1, ratingPoints: 0, firstGameAt: 10, lastGameAt: 300 });
});

test('normalized duplicates ignore unused raw properties but reject changed outcomes', () => {
  const raw = game();
  assert.equal(parseDataset(text([raw, { ...raw, clocks: [100] }])).report.duplicates, 1);
  assert.throws(() => parseDataset(text([raw, { ...raw, winner: 'black' }])), /line 2|строк.*2/i);
});

for (const overrides of [{ rated: false }, { variant: 'chess960' }, { speed: 'classical' }, { status: 'started' }]) {
  const criterion = Object.keys(overrides)[0];
  for (const skippedFirst of [false, true]) {
    test(`duplicate ${criterion} eligibility conflicts reject with skipped row ${skippedFirst ? 'first' : 'second'}`, () => {
      const eligible = game();
      const skipped = game(overrides);
      const records = skippedFirst ? [skipped, eligible] : [eligible, skipped];
      assert.throws(() => parseDataset('\n' + text(records)), /строк.*3.*противоречив/i);
    });
  }
}

test('ordinary skipped rows keep their count alongside eligible normalized duplicates', () => {
  const eligible = game();
  const skipped = game({ id: 'Skip1234', rated: false });
  const result = parseDataset(text([skipped, eligible, { ...eligible, clocks: [5] }, skipped]));
  assert.deepEqual(result.report, { rows: 4, unique: 1, duplicates: 1, skipped: 2, ratingPoints: 0, firstGameAt: 1000, lastGameAt: 1000 });
});

test('conflicting outcomes in repeated skipped games reject at their actual source line', () => {
  const skipped = game({ id: 'Skip1234', rated: false });
  const changed = { ...skipped, winner: 'black' };
  for (const records of [[skipped, game(), changed], [changed, game(), skipped]]) {
    assert.throws(() => parseDataset('\n' + text(records)), /строк.*4.*противоречив/i);
  }
});

test('repeated skipped games compare normalized fields and keep each skipped row count', () => {
  const skipped = game({ id: 'Skip1234', rated: false });
  const same = Object.fromEntries(Object.entries({ ...skipped, clocks: [1, 2], unneeded: 'ignored' }).reverse());
  const eligible = game();
  const result = parseDataset(text([skipped, eligible, same, { ...eligible, clocks: [5] }]));
  assert.deepEqual(result.report, { rows: 4, unique: 1, duplicates: 1, skipped: 2, ratingPoints: 0, firstGameAt: 1000, lastGameAt: 1000 });
});

test('JSON and validation errors identify the actual source line including blanks', () => {
  assert.throws(() => parseDataset(`\n${text([game()])}\n\n{`), /line 4|строк.*4/i);
  assert.throws(() => parseDataset(`\n${text([game()])}\n\n${text([game({ id: 'bad' })])}`), /line 4|строк.*4/i);
});

test('empty files and files containing only skipped games reject', () => {
  for (const input of ['', '\n \n', text([game({ rated: false })])]) assert.throws(() => parseDataset(input));
});

test('all game rows and optional ratings validate before a preview returns', () => {
  assert.throws(() => parseDataset(text([game()]), '{'));
  assert.throws(() => parseDataset(text([game(), game({ id: 'bad' })])));
  assert.throws(() => parseDataset(text([game()]), 'null'));
});

test('text byte limits count UTF-8 and permit the exact size boundary', () => {
  const row = text([game()]);
  const limit = 20 * 1024 * 1024;
  assert.equal(parseDataset(row + ' '.repeat(limit - Buffer.byteLength(row))).report.unique, 1);
  assert.throws(() => parseDataset(row + ' '.repeat(limit - Buffer.byteLength(row) - 1) + 'я'), /size|MiB|размер/i);
  const ratings = '[]';
  assert.deepEqual(normalizeRatingHistory(ratings + ' '.repeat(1024 * 1024 - 2)), []);
  assert.throws(() => normalizeRatingHistory(ratings + ' '.repeat(1024 * 1024 - 3) + 'я'), /size|MiB|размер/i);
});

test('nonempty row limit includes duplicate and skipped rows', () => {
  const row = text([{ id: 'Abcd1234', rated: true, variant: 'standard', speed: 'bullet', createdAt: 0, lastMoveAt: 0, status: 'draw', players: { white: { user: { id: 'sebajun777' } }, black: { user: { id: 'a' } } } }]);
  assert.equal(parseDataset(Array(100000).fill(row).join('\n')).report.duplicates, 99999);
  const skippedRow = row.replace('Abcd1234', 'Skip1234').replace('"rated":true', '"rated":false');
  assert.throws(() => parseDataset('\n\n' + [row, ...Array(100000).fill(skippedRow)].join('\n')), /line 100003|строк.*100003/i);
});

test('ratings normalize month zero, leapday, duplicate series and sorted dates', () => {
  const input = JSON.stringify([
    { name: 'Bullet', points: [[2024, 1, 29, 2100], [2024, 0, 1, 2000]] },
    { name: 'Bullet', points: [[2024, 0, 1, 2000], [2024, 2, 1, 2200]] },
    { name: 'Puzzles', points: [[2024, 0, 1, 2500]] },
    { name: 'Blitz', points: [] }, { name: 'UltraBullet', points: 'ignored' },
  ]);
  assert.deepEqual(normalizeRatingHistory(input), [
    { name: 'Bullet', points: [{ date: '2024-01-01', rating: 2000 }, { date: '2024-02-29', rating: 2100 }, { date: '2024-03-01', rating: 2200 }] },
    { name: 'Blitz', points: [] },
    { name: 'Puzzles', points: [{ date: '2024-01-01', rating: 2500 }] },
  ]);
  assert.equal(parseDataset(text([game()]), input).report.ratingPoints, 4);
});

for (const [name, value] of [
  ['non-array', {}], ['null series', [null]], ['nonobject series', ['Bullet']],
  ['missing points', [{ name: 'Bullet' }]], ['sparse point', [{ name: 'Bullet', points: [null] }]],
  ['non leapday', [{ name: 'Bullet', points: [[2023, 1, 29, 2000]] }]],
  ['invalid day', [{ name: 'Bullet', points: [[2024, 3, 31, 2000]] }]],
  ['month too large', [{ name: 'Bullet', points: [[2024, 12, 1, 2000]] }]],
  ['negative month', [{ name: 'Bullet', points: [[2024, -1, 1, 2000]] }]],
  ['fractional rating', [{ name: 'Bullet', points: [[2024, 0, 1, 2000.5]] }]],
  ['zero rating', [{ name: 'Bullet', points: [[2024, 0, 1, 0]] }]],
  ['duplicate conflict', [{ name: 'Bullet', points: [[2024, 0, 1, 2000], [2024, 0, 1, 2001]] }]],
  ['cross-series conflict', [{ name: 'Bullet', points: [[2024, 0, 1, 2000]] }, { name: 'Bullet', points: [[2024, 0, 1, 2001]] }]],
]) {
  test(`rating history rejects ${name}`, () => assert.throws(() => normalizeRatingHistory(JSON.stringify(value))));
}
