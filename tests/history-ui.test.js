import test from 'node:test';
import assert from 'node:assert/strict';
import * as history from '../extension/ui/history.js';
import * as view from '../extension/ui/history-view.js';

const overview = { totalGames: 1, firstGameAt: 1, lastGameAt: 1, importedAt: '2026-10-04T00:00:00Z', sourceName: 'games.ndjson', groups: [], ratings: [] };
const preview = { rows: 2, unique: 1, duplicates: 1, skipped: 0, ratingPoints: 0, firstGameAt: 1, lastGameAt: 1 };
const file = (text = '{}', name = 'games.ndjson') => ({ name, size: text.length, text: async () => text });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(request) {
  const rendered = [], previews = [], errors = [], success = [], busy = [];
  const controller = history.createHistoryController({ client: { request }, renderOverview: (value) => rendered.push(value), renderPreview: (value) => previews.push(value), setBusy: (value) => busy.push(value), showError: (error) => errors.push(error.message), showSuccess: (message) => success.push(message) });
  return { controller, rendered, previews, errors, success, busy };
}

test('changing selection invalidates a pending preview and prevents import of its old file', async () => {
  let finishPreview;
  const { controller, previews, success } = fixture(() => new Promise((resolve) => { finishPreview = resolve; }));
  const pending = controller.previewFiles(file());
  await settle();
  controller.invalidatePreview();
  finishPreview(preview);
  await pending;
  assert.equal(previews.at(-1), null);
  assert.equal(await controller.import(), false);
  assert.equal(success.length, 0);
});

test('a changed file selection suppresses stale file-read errors', async () => {
  let failRead;
  const { controller, errors } = fixture(() => assert.fail('stale file should not reach service'));
  const pending = controller.previewFiles({ name: 'old.ndjson', size: 1, text: () => new Promise((resolve, reject) => { failRead = reject; }) });
  await settle();
  controller.invalidatePreview();
  failRead(new Error('Old file no longer readable'));
  await pending;
  assert.deepEqual(errors, []);
});

test('serialized overview reads cannot overwrite a newly committed import and success waits for commit', async () => {
  let finishRead, finishWrite;
  const { controller, rendered, success, busy } = fixture((command) => {
    if (command.type === 'history.previewImport') return Promise.resolve(preview);
    if (command.type === 'history.getOverview') return new Promise((resolve) => { finishRead = resolve; });
    assert.deepEqual(command, { type: 'history.import', gamesText: '{}', sourceName: 'games.ndjson' });
    return new Promise((resolve) => { finishWrite = resolve; });
  });
  await controller.previewFiles(file());
  const read = controller.refresh();
  await settle();
  const write = controller.import();
  assert.deepEqual(success, []);
  finishRead(overview);
  await read;
  await settle();
  assert.equal(rendered.at(-1).totalGames, 1);
  assert.deepEqual(success, []);
  finishWrite({ overview: { ...overview, totalGames: 2 }, report: { rows: 2, unique: 1, duplicates: 1, skipped: 0, added: 1, existing: 0, total: 2 } });
  await write;
  assert.equal(rendered.at(-1).totalGames, 2);
  assert.equal(success.length, 1);
  assert.equal(busy.at(-1), false);
});

test('a failed history save or refresh preserves the successful overview and preview remains retryable', async () => {
  let fail = false;
  const { controller, rendered, success, errors } = fixture(async (command) => {
    if (command.type === 'history.previewImport') return preview;
    if (fail || command.type === 'history.import') throw new Error('Storage full');
    return overview;
  });
  await controller.refresh();
  await controller.previewFiles(file());
  assert.equal(await controller.import(), false);
  assert.equal(await controller.import(), false);
  fail = true;
  await controller.refresh();
  assert.deepEqual(rendered, [overview]);
  assert.deepEqual(success, []);
  assert.deepEqual(errors, ['Storage full', 'Storage full', 'Storage full']);
});

test('oversized or absent files fail before either file is read', async () => {
  let reads = 0;
  const small = { name: 'games.ndjson', size: 1, text: async () => { reads++; return '{}'; } };
  const large = { name: 'large', size: 20 * 1024 * 1024 + 1, text: small.text };
  await assert.rejects(history.readHistoryFiles(large), /20/);
  await assert.rejects(history.readHistoryFiles(small, { ...large, size: 1024 * 1024 + 1 }), /1/);
  await assert.rejects(history.readHistoryFiles(null));
  assert.equal(reads, 0);
  await assert.rejects(history.readHistoryFiles(file('   ')));
});

test('rating coordinates use elapsed dates and only the selected series', () => {
  const data = view.ratingChartData([{ name: 'Bullet', points: [{ date: '2026-01-01', rating: 1000 }, { date: '2026-01-02', rating: 1050 }, { date: '2026-01-11', rating: 1100 }] }, { name: 'Blitz', points: [{ date: '2026-01-01', rating: 4000 }] }], 'Bullet');
  assert.equal(data.points.length, 3);
  const [first, middle, last] = data.points;
  assert.ok(Math.abs((middle.x - first.x) / (last.x - first.x) - 0.1) < 0.000001);
  assert.equal(data.minRating, 1000);
  assert.equal(data.maxRating, 1100);
  assert.ok(last.y < first.y);
  assert.equal(view.ratingChartData([], 'Rapid').points.length, 0);
});

test('a single or constant rating has finite coordinates within the graph', () => {
  for (const points of [[{ date: '2026-03-15', rating: 1800 }], [{ date: '2026-03-14', rating: 1800 }, { date: '2026-03-15', rating: 1800 }]]) {
    const data = view.ratingChartData([{ name: 'Rapid', points }], 'Rapid');
    for (const point of data.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x > 0 && point.x < data.width && point.y > 0 && point.y < data.height);
    }
  }
});

function renderFixture(ids = []) {
  const document = {
    createElement: (name) => makeNode(name),
    createElementNS: (namespace, name) => makeNode(name),
    createDocumentFragment: () => makeNode('fragment'),
  };
  function makeNode(name) {
    return { name, ownerDocument: document, children: [], attributes: {}, hidden: false, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attributes[key] = value; },
    };
  }
  const elements = Object.fromEntries(ids.map((id) => [id, makeNode('div')]));
  const container = makeNode('div');
  container.querySelector = (selector) => elements[selector.slice(1)];
  return { container, elements };
}

test('overview renders historical sample size, percent and dated ratings without treating source names as markup', () => {
  const { container, elements } = renderFixture(['history-period', 'history-metadata', 'history-stats', 'history-table']);
  view.renderHistoryOverview(container, { ...overview, totalGames: 4, firstGameAt: Date.parse('2026-03-10T12:00:00Z'), lastGameAt: Date.parse('2026-03-15T12:00:00Z'), sourceName: '<img src=x onerror=run()>', groups: [{ speed: 'bullet', games: 4, wins: 2, losses: 1, draws: 1, analysed: 1, winRate: 50, lastRating: 2143, ratingDate: '2026-03-15' }] });
  const row = elements['history-stats'].children[0].children[0];
  assert.equal(row.children[3].textContent, '50%');
  assert.equal(row.children[4].textContent, '1 из 4 (25%)');
  assert.match(row.children[5].textContent, /2026/);
  assert.match(elements['history-period'].textContent, /2026/);
  assert.match(elements['history-metadata'].textContent, /<img src=x onerror=run\(\)>/);
  assert.equal(elements['history-metadata'].children.length, 0);
  assert.equal(elements['history-table'].hidden, false);
});

test('rating rendering replaces the selected graph and provides empty and single-point accessible states', () => {
  const { container } = renderFixture();
  const ratings = [{ name: 'Bullet', points: [{ date: '2026-03-14', rating: 2000 }, { date: '2026-03-15', rating: 2100 }] }, { name: 'Puzzles', points: [{ date: '2026-03-15', rating: 2700 }] }];
  view.renderRatingChart(container, ratings, 'Bullet');
  assert.equal(container.children.filter((element) => element.name === 'svg').length, 1);
  assert.match(container.children[0].attributes['aria-label'], /2000|2\s000/);
  assert.equal(container.children[0].children.filter((element) => element.name === 'polyline').length, 1);
  view.renderRatingChart(container, ratings, 'Puzzles');
  assert.equal(container.children.filter((element) => element.name === 'svg').length, 1);
  const svg = container.children[0];
  assert.match(svg.attributes['aria-label'], /Puzzles/);
  assert.match(svg.attributes['aria-label'], /2700|2\s700/);
  assert.doesNotMatch(svg.attributes['aria-label'], /2000|2\s000/);
  assert.equal(svg.children.filter((element) => element.name === 'circle').length, 1);
  assert.equal(svg.children.filter((element) => element.name === 'polyline').length, 0);
  view.renderRatingChart(container, ratings, 'Rapid');
  assert.equal(container.children.filter((element) => element.name === 'svg').length, 0);
  assert.match(container.children[0].textContent, /Rapid/);
});
