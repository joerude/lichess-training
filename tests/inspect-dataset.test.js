import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/inspect-dataset.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

const gameOf = login => JSON.stringify({
  id: 'abcdefgh', rated: true, variant: 'standard', speed: 'blitz', status: 'mate', winner: 'white',
  createdAt: Date.parse('2026-10-05T10:00:00Z'), lastMoveAt: Date.parse('2026-10-05T10:01:00Z'),
  players: { white: { user: { id: login.toLowerCase(), name: login }, rating: 2100, ratingDiff: 5 },
    black: { user: { id: 'opponent', name: 'Opponent' }, rating: 2000, ratingDiff: -5 } },
  moves: 'e4 e5',
});

test('without a login and a games file the script prints a hint and exits with code 2', () => {
  for (const args of [[], ['magnus_fan'], ['', 'games.ndjson']]) {
    const result = run(...args);
    assert.equal(result.status, 2, `arguments: ${JSON.stringify(args)}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /inspect:dataset -- <логин> games_raw\.ndjson \[rating_history\.json\]/);
  }
});

test('the login comes first, the games file second, and games of another login are refused', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inspect-dataset-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const games = join(directory, 'games.ndjson');
  await writeFile(games, `${gameOf('Magnus_Fan')}\n`);
  const inspected = run('Magnus_Fan', games);
  assert.equal(inspected.status, 0, inspected.stderr);
  const output = JSON.parse(inspected.stdout);
  assert.deepEqual([output.report.rows, output.report.unique], [1, 1]);
  const blitz = output.groups.find(group => group.speed === 'blitz');
  assert.deepEqual([blitz.games, blitz.lastRating], [1, 2105]);
  const foreign = run('sebajun777', games);
  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /профил/i);
  assert.equal(foreign.stdout, '');
});

test('a login that Lichess cannot have is reported before any file is read', () => {
  const result = run('games.ndjson', 'rating_history.json');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Логин Lichess/);
  assert.equal(result.stdout, '');
});
