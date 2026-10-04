import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTrainingMessages } from '../extension/background-transport.js';
import { createClient } from '../extension/ui/client.js';
import { createRepository } from '../extension/data/repository.js';
import { createTrainingService } from '../extension/app/training.js';
import { IDBFactory } from 'fake-indexeddb';

function register(service) {
  let listener;
  const runtime = {
    id: 'lichess-training@local',
    onMessage: { addListener(value) { listener = value; } },
  };
  registerTrainingMessages(runtime, service);
  assert.equal(typeof listener, 'function', 'listener registered before returning');
  return (command, sender = { id: runtime.id }) => listener(command, sender);
}

test('background returns a successful service result in the message envelope', async () => {
  const listener = register({ handle: async (command) => ({ completed: command.completed }) });
  assert.deepEqual(await listener({ completed: true }), { ok: true, data: { completed: true } });
});

test('background converts rejected and synchronous service failures into error envelopes', async () => {
  for (const handle of [
    async () => { throw new Error('Storage transaction failed'); },
    () => { throw new Error('Storage transaction failed'); },
  ]) {
    assert.deepEqual(await register({ handle })({}), { ok: false, error: 'Storage transaction failed' });
  }
});

test('background refuses outside or missing senders before calling the service', async () => {
  let calls = 0;
  const listener = register({ handle: () => { calls += 1; return {}; } });
  for (const sender of [{ id: 'outside@local' }, {}, undefined]) {
    const result = await listener({}, sender === undefined ? null : sender);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(calls, 0);
});

test('real service messages persist completion and expose midnight errors through the client', async () => {
  let instant = new Date('2026-10-04T17:59:00Z');
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const listener = register(createTrainingService({ repository, now: () => instant }));
  const client = createClient({ sendMessage: (command) => listener(command) });
  const initial = await client.request({ type: 'training.getSnapshot' });
  assert.equal(initial.today.date, '2026-10-04');
  const completed = await client.request({ type: 'training.setCompletion', day: initial.today.date, completed: true });
  assert.equal(completed.today.completed, true);
  const persisted = await repository.read();
  assert.equal(persisted.days[0].completedAt, '2026-10-04T17:59:00.000Z');
  instant = new Date('2026-10-04T18:00:00Z');
  await assert.rejects(client.request({ type: 'training.setCompletion', day: initial.today.date, completed: false }));
  const nextDay = await client.request({ type: 'training.getSnapshot' });
  assert.equal(nextDay.today.date, '2026-10-05');
  assert.equal(nextDay.today.completed, false);
  assert.equal(nextDay.completedDays, 1);
});
