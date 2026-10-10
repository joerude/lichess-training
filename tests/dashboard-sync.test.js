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
      async dispatch(type) { for (const handler of handlers.get(type) || []) await handler({ preventDefault() {} }); },
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; void this.dispatch('close'); },
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
  await waitFor(() => element('program-summary').textContent.includes('XP') && !element('completion').disabled);
  assert.equal(commands.filter((type) => type === 'program.getSnapshot').length, 1, 'initial page render must not duplicate program reads');
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
  await waitFor(() => element('program-tasks').children[0]?.children[1]?.textContent === '1 из 5');
  const baselineBackup = await services.handle({ type: 'training.export' });
  element('review-game').value = 'import01';
  await element('review-game').dispatch('input');
  element('review-note').value = 'Проверю угрозы перед ходом';
  await element('review-note').dispatch('input');
  await element('review-form').dispatch('submit');
  assert.equal(element('review-list').children.length, 1);
  await element('completion').dispatch('click');
  await waitFor(() => !element('completion').disabled && element('today-status').textContent.includes('выполнена'));
  const loadBackup = async (backup) => {
    const backupText = JSON.stringify(backup);
    element('backup-file').files = [{ name: 'backup.json', size: backupText.length, text: async () => backupText }];
    await element('backup-file').dispatch('change');
    assert.equal(element('restore-dialog').open, true);
    assert.equal(commands.at(-1), 'training.previewImport');
  };
  await loadBackup({ format: baselineBackup.format, version: 1, exportedAt: baselineBackup.exportedAt, state: baselineBackup.state });
  assert.match(element('restore-description').textContent, /только отметки задач/);
  assert.match(element('restore-description').textContent, /собственные разборы сохраняются/);
  assert.equal((await services.handle({ type: 'program.getSnapshot' })).reviews.length, 1, 'preview must not modify current reviews');
  await element('replace').dispatch('click');
  await waitFor(() => !element('restore-dialog').open && element('program-tasks').children[2]?.children[1]?.textContent === '0 из 10');
  assert.equal((await services.handle({ type: 'program.getSnapshot' })).reviews.length, 1, 'legacy restore preserves own reviews');
  await loadBackup(baselineBackup);
  assert.match(element('restore-description').textContent, /собственные разборы и награды/);
  assert.match(element('restore-description').textContent, /История партий, рейтинги и состояние загрузки сохраняются/);
  await element('replace').dispatch('click');
  await waitFor(() => !element('restore-dialog').open && element('review-list').children.length === 0);
  assert.equal((await services.handle({ type: 'history.getOverview' })).totalGames, 1, 'backup restore must not erase game history');
  assert.equal((await services.handle({ type: 'sync.getSnapshot' })).today.groups[0].games, 1);
  assert.equal(commands.filter((type) => type === 'sync.getSnapshot').length, 2, 'backup restore does not repeat sync reads');
  assert.equal(commands.filter((type) => type === 'training.previewImport').length, 2);
  element('backup-file').files = [{ name: 'oversized.json', size: 16 * 1024 * 1024 + 1, text: () => assert.fail('oversized backup must not be read') }];
  await element('backup-file').dispatch('change');
  assert.match(element('error').textContent, /16 МиБ/);
  assert.equal(commands.filter((type) => type === 'training.previewImport').length, 2);
});
