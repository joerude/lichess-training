import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createTrainingService } from '../extension/app/training.js';

test('read starts empty and transact only resolves once new state is durable', async () => {
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB });
  assert.equal(await repository.read(), null);
  assert.deepEqual(await repository.transact(() => ({ count: 1 })), { count: 1 });
  assert.deepEqual(await createRepository({ indexedDB }).read(), { count: 1 });
});

test('transactions from independent connections serialize read-modify-write', async () => {
  const indexedDB = new IDBFactory();
  const first = createRepository({ indexedDB });
  const second = createRepository({ indexedDB });
  await first.transact(() => ({ count: 0 }));
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).transact(current => ({ count: current.count + 1 }))));
  assert.deepEqual(await first.read(), { count: 20 });
});

test('throwing updater aborts even after mutating the received state', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 1 }));
  await assert.rejects(repository.transact(current => {
    current.count = 100;
    throw new Error('updater failed');
  }), /updater failed/);
  assert.deepEqual(await repository.read(), { count: 1 });
});

test('asynchronous updaters are rejected without mutation', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 1 }));
  await assert.rejects(repository.transact(async () => ({ count: 2 })), /synchronous/i);
  assert.deepEqual(await repository.read(), { count: 1 });
});

test('storage clone failure rejects and leaves prior state intact', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  await repository.transact(() => ({ count: 1 }));
  await assert.rejects(repository.transact(() => ({ bad: () => {} })));
  assert.deepEqual(await repository.read(), { count: 1 });
});

test('successful storage request followed by transaction abort never reports command success', async context => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const service = createTrainingService({ repository, now: () => new Date('2026-10-04T10:00:00.000Z') });
  await service.handle({ type: 'training.getSnapshot' });
  const before = await repository.read();
  const put = IDBObjectStore.prototype.put;
  context.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = put.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await assert.rejects(service.handle({ type: 'training.setCompletion', day: '2026-10-04', completed: true }), /abort/i);
  assert.deepEqual(await repository.read(), before);
});

test('returned and read objects cannot mutate stored state by reference', async () => {
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const saved = await repository.transact(() => ({ nested: { count: 1 } }));
  saved.nested.count = 2;
  const read = await repository.read();
  read.nested.count = 3;
  assert.deepEqual(await repository.read(), { nested: { count: 1 } });
});

test('unavailable IndexedDB rejects commands with an actionable storage error', async () => {
  const service = createTrainingService({ repository: createRepository({ indexedDB: null }), now: () => new Date('2026-10-04T10:00:00.000Z') });
  await assert.rejects(service.handle({ type: 'training.setCompletion', day: '2026-10-04', completed: true }), /storage|IndexedDB|хранилищ/i);
});
