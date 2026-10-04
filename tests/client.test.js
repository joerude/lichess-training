import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createTrainingController, nextDayDelay } from '../extension/ui/client.js';

test('client unwraps the result and sends the displayed completion date unchanged', async () => {
  const client = createClient({ sendMessage: async (command) => {
    assert.deepEqual(command, { type: 'training.setCompletion', day: '2026-10-04', completed: true });
    return { ok: true, data: { today: { date: '2026-10-04', completed: true } } };
  } });
  assert.deepEqual(await client.request({ type: 'training.setCompletion', day: '2026-10-04', completed: true }),
    { today: { date: '2026-10-04', completed: true } });
});

test('client throws service failures, malformed replies, and unavailable background errors', async () => {
  await assert.rejects(createClient({ sendMessage: async () => ({ ok: false, error: 'Disk full' }) }).request({}), /Disk full/);
  for (const reply of [undefined, {}, { ok: true }, { ok: false }, { ok: 'true', data: {} }]) {
    await assert.rejects(createClient({ sendMessage: async () => reply }).request({}));
  }
  await assert.rejects(createClient({ sendMessage: async () => { throw new Error('Background unavailable'); } }).request({}), /Background unavailable/);
});

test('day timer finds Bishkek midnight immediately before and after the UTC boundary', () => {
  assert.equal(nextDayDelay(new Date('2026-10-04T17:59:59.000Z'), 'Asia/Bishkek'), 1050);
  assert.equal(nextDayDelay(new Date('2026-10-04T18:00:00.000Z'), 'Asia/Bishkek'), 86400050);
});

test('controller serializes a refresh and write without reporting optimistic completion', async () => {
  let resolveRead;
  let resolveWrite;
  const rendered = [];
  const commands = [];
  const busy = [];
  const controller = createTrainingController({
    client: { request(command) {
      commands.push(command);
      return new Promise((resolve) => {
        if (command.type === 'training.getSnapshot') resolveRead = resolve;
        else resolveWrite = resolve;
      });
    } },
    render: (snapshot) => rendered.push(snapshot),
    setBusy: (value) => busy.push(value),
    showError: () => assert.fail('unexpected error'),
    showSuccess: () => {},
  });
  const read = controller.refresh();
  await Promise.resolve();
  const write = controller.mutate({ type: 'training.setCompletion', day: '2026-10-04', completed: true });
  assert.equal(busy.at(-1), true);
  assert.equal(rendered.length, 0);
  resolveRead({ today: { completed: false } });
  await read;
  await Promise.resolve();
  assert.equal(commands.length, 2);
  assert.equal(rendered.at(-1).today.completed, false);
  resolveWrite({ today: { completed: true } });
  await write;
  assert.equal(rendered.at(-1).today.completed, true);
  assert.equal(busy.at(-1), false);
});

test('controller reports a failed save and retains the last persisted snapshot', async () => {
  const rendered = [];
  const errors = [];
  const controller = createTrainingController({
    client: { request: async (command) => {
      if (command.type === 'training.getSnapshot') return { today: { completed: false } };
      throw new Error('Disk full');
    } },
    render: (snapshot) => rendered.push(snapshot), setBusy: () => {},
    showError: (error, source) => errors.push({ message: error.message, source }), showSuccess: () => assert.fail('false success'),
  });
  await controller.refresh();
  assert.equal(await controller.mutate({ type: 'training.setCompletion' }), false);
  assert.deepEqual(errors, [{ message: 'Disk full', source: 'training.setCompletion' }]);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].today.completed, false);
});

test('a refresh requested while an old read is pending gets a fresh snapshot after that read', async () => {
  const pending = [];
  const rendered = [];
  const controller = createTrainingController({
    client: { request: () => new Promise((resolve) => pending.push(resolve)) },
    render: (snapshot) => rendered.push(snapshot), setBusy: () => {},
    showError: () => assert.fail('unexpected error'), showSuccess: () => {},
  });
  const beforeSleep = controller.refresh();
  await Promise.resolve();
  const afterWake = controller.refresh();
  pending[0]({ today: { date: '2026-10-04' } });
  await beforeSleep;
  await Promise.resolve();
  assert.equal(pending.length, 2, 'resume must read again rather than reuse a pre-sleep request');
  pending[1]({ today: { date: '2026-10-05' } });
  await afterWake;
  assert.equal(rendered.at(-1).today.date, '2026-10-05');
});
