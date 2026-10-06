import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createServices } from '../extension/app/services.js';
import { registerTrainingMessages } from '../extension/background-transport.js';
import { createClient } from '../extension/ui/client.js';
import { createLichessClient } from '../extension/data/lichess-client.js';

test('one message transport routes history and training to their shared persistent repository', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const service = createServices({ repository, now: () => new Date('2026-10-04T12:00:00Z') });
  let listener;
  const runtime = { id: 'lichess-training@local', onMessage: { addListener(value) { listener = value; } } };
  registerTrainingMessages(runtime, service);
  const client = createClient({ sendMessage: command => listener(command, { id: runtime.id }) });
  assert.equal((await client.request({ type: 'history.getOverview' })).totalGames, 0);
  assert.equal(await repository.read(), null, 'reading history does not start the training program');
  const snapshot = await client.request({ type: 'training.getSnapshot' });
  const marked = await client.request({ type: 'training.setCompletion', day: snapshot.today.date, completed: true });
  assert.equal(marked.today.completed, true);
  const gamesText = JSON.stringify({ id: 'abcdefgh', rated: true, variant: 'standard', speed: 'blitz',
    createdAt: 1773576000000, lastMoveAt: 1773576200000, status: 'mate', winner: 'white',
    players: { white: { user: { id: 'sebajun777', name: 'sebajun777' }, rating: 1700, ratingDiff: 7 },
      black: { user: { id: 'opponent', name: 'Opponent' }, rating: 1750, ratingDiff: -7 } } });
  const preview = await client.request({ type: 'history.previewImport', gamesText });
  assert.equal(preview.unique, 1);
  assert.equal((await client.request({ type: 'history.getOverview' })).totalGames, 0);
  const imported = await client.request({ type: 'history.import', gamesText, sourceName: 'sample.ndjson' });
  assert.equal(imported.report.added, 1);
  assert.equal(imported.overview.groups.find(group => group.speed === 'blitz').lastRating, 1707);
  assert.equal((await client.request({ type: 'training.getSnapshot' })).today.completed, true);
  await assert.rejects(client.request({ type: 'history.unknown' }), /Неизвестная команда истории/);
  await assert.rejects(client.request(null), /Некорректная команда/);
});

test('live NDJSON travels through messages into persistent counts without changing training marks', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const instant = new Date('2026-10-06T06:00:00Z');
  let requests = 0;
  const lichess = createLichessClient({ fetchImpl: async (url, options) => {
    requests++;
    assert.equal(new URL(url).pathname, '/api/games/user/sebajun777');
    assert.equal(options.credentials, 'omit');
    const raw = { id: 'live0001', createdAt: instant.getTime() - 60000, lastMoveAt: instant.getTime() - 1,
      rated: true, variant: 'standard', speed: 'rapid', status: 'mate', winner: 'black',
      players: { white: { user: { id: 'opponent' }, rating: 1800 },
        black: { user: { id: 'sebajun777' }, rating: 1800, ratingDiff: 6 } } };
    return new Response(`${JSON.stringify(raw)}\n`, { headers: { 'Content-Type': 'application/x-ndjson' } });
  } });
  const service = createServices({ repository, lichess, canAccess: async () => true, now: () => instant });
  let listener;
  const runtime = { id: 'lichess-training@local', onMessage: { addListener(value) { listener = value; } } };
  registerTrainingMessages(runtime, service);
  const client = createClient({ sendMessage: command => listener(command, { id: runtime.id }) });
  const local = await client.request({ type: 'sync.getSnapshot' });
  assert.equal(local.today.groups[2].games, 0);
  assert.equal(requests, 0);
  assert.equal(await repository.read(), null);
  const journal = await client.request({ type: 'training.getSnapshot' });
  await client.request({ type: 'training.setCompletion', day: journal.today.date, completed: true });
  const before = await repository.read();
  const loaded = await client.request({ type: 'sync.nextBatch' });
  assert.equal(loaded.snapshot.today.groups[2].games, 1);
  assert.equal(loaded.report.added, 1);
  assert.equal((await client.request({ type: 'history.getOverview' })).groups[2].lastRating, 1806);
  assert.deepEqual(await repository.read(), before);
  assert.equal(requests, 1);
});
