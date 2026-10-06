import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/data/repository.js';
import { createServices } from '../extension/app/services.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await settle();
  }
  assert.fail('dashboard did not reach the expected state');
}

function dashboardDocument() {
  const elements = new Map();
  let document;
  document = makeNode();
  document.visibilityState = 'visible';
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, makeNode());
    return elements.get(id);
  };
  document.querySelector = (selector) => document.getElementById(selector.replace(/^[#.]/, ''));
  document.querySelectorAll = () => [];
  document.createElement = () => makeNode();
  document.createElementNS = () => makeNode();
  document.createDocumentFragment = () => makeNode();
  function makeNode() {
    const handlers = new Map();
    return { ownerDocument: document, textContent: '', hidden: false, disabled: false, value: 'Bullet', files: [], attributes: {}, children: [],
      classList: { toggle() {} },
      setAttribute(key, value) { this.attributes[key] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      querySelector(selector) { return document.querySelector(selector); },
      addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(handler); },
      dispatch(type) { for (const handler of handlers.get(type) || []) handler(); },
    };
  }
  return { document, window: makeNode() };
}

test('dashboard history import immediately refreshes stored sync counts, total and initial coverage floor', async (context) => {
  const dom = dashboardDocument();
  const instant = new Date('2026-10-06T17:59:59Z');
  const repository = createRepository({ indexedDB: new IDBFactory() });
  const services = createServices({ repository, now: () => instant, canAccess: async () => false,
    lichess: { fetchGamesPage: async () => assert.fail('local import must not access Lichess') } });
  const commands = [];
  context.mock.method(globalThis, 'setTimeout', () => 1);
  context.mock.method(globalThis, 'clearTimeout', () => {});
  const globals = { document: dom.document, window: dom.window, browser: { runtime: { sendMessage: async (command) => {
    commands.push(command.type);
    return { ok: true, data: await services.handle(command) };
  } } } };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    context.after(() => original ? Object.defineProperty(globalThis, key, original) : Reflect.deleteProperty(globalThis, key));
  }
  await import('../extension/ui/dashboard.js');
  const element = (id) => dom.document.getElementById(id);
  await waitFor(() => element('sync-total').textContent.includes('0 партий') && !element('history-preview-button').disabled);
  const initialCoverage = element('sync-coverage').textContent;
  const raw = { id: 'import01', rated: true, variant: 'standard', speed: 'bullet', status: 'mate',
    createdAt: Date.parse('2026-10-06T17:58:59Z'), lastMoveAt: Date.parse('2026-10-06T17:59:58Z'), winner: 'white',
    players: { white: { user: { id: 'sebajun777' }, rating: 2000, ratingDiff: 5 }, black: { user: { id: 'opponent' }, rating: 2000 } }, moves: 'e4 e5' };
  const text = JSON.stringify(raw);
  element('history-games-file').files = [{ name: 'games.ndjson', size: text.length, text: async () => text }];
  element('history-preview-button').dispatch('click');
  await waitFor(() => !element('history-import-button').disabled);
  element('history-import-button').dispatch('click');
  await waitFor(() => element('history-period').textContent.startsWith('1 партий') && !element('completion').disabled);
  assert.equal(element('sync-total').textContent, 'Всего в загруженной истории: 1 партий.');
  assert.equal(element('sync-bullet').textContent, '1');
  assert.equal(element('sync-blitz').textContent, '0');
  assert.equal(element('sync-rapid').textContent, '0');
  assert.notEqual(element('sync-coverage').textContent, initialCoverage);
  assert.match(element('sync-coverage').textContent, /29\.09\.2026/);
  assert.equal(commands.filter((type) => type === 'sync.getSnapshot').length, 2);
  assert.equal(commands.filter((type) => type === 'history.getOverview').length, 1);
  assert.equal(commands.includes('sync.nextBatch'), false);
  assert.ok(commands.lastIndexOf('sync.getSnapshot') > commands.indexOf('history.import'));
});
