import test from 'node:test';
import assert from 'node:assert/strict';
import { puzzlePhrase, formatClock, mountPuzzleCard } from '../extension/ui/puzzle-card.js';

function fixture(request) {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { id, textContent: '', hidden: true, max: 1, value: 0 });
    return nodes.get(id);
  } };
  let autoCompletes = 0;
  const errors = [];
  const card = mountPuzzleCard({ client: { request }, document,
    onAutoComplete: () => { autoCompletes += 1; }, onError: error => { errors.push(error.message); } });
  return { card, node: id => document.getElementById(id), autoCompletes: () => autoCompletes, errors };
}
const reading = (changes = {}) => ({ status: 'ok', date: '2026-10-12', solved: 4, target: 10, completed: false, source: null,
  baselineAt: '2026-10-12T03:14:00.000Z', observedAt: '2026-10-12T04:02:00.000Z', autoCompleted: false, ...changes });

test('phrases follow progress for targets 1, 10 and 11', () => {
  const phrase = (solved, target = 10, status = 'ok', completed = solved !== null && solved >= target) => puzzlePhrase({ solved, target, status, completed });
  assert.equal(phrase(0), 'Начнём — 10 задач на сегодня');
  assert.equal(phrase(1), 'Хорошее начало — осталось 9');
  assert.equal(phrase(4), 'Хорошее начало — осталось 6');
  assert.equal(phrase(5), 'Так держать — осталось 5');
  assert.equal(phrase(9), 'Так держать — осталось 1');
  assert.equal(phrase(10), 'Норма выполнена! +20 XP');
  assert.equal(phrase(13), 'Сверх нормы: 13 задач');
  assert.equal(phrase(0, 1), 'Начнём — 1 задача на сегодня');
  assert.equal(phrase(1, 1), 'Норма выполнена! +20 XP');
  assert.equal(phrase(5, 11), 'Хорошее начало — осталось 6');
  assert.equal(phrase(6, 11), 'Так держать — осталось 5');
  assert.equal(phrase(null, 10, 'no-permission'), 'Автоподсчёт выключен: подключите Lichess на основном экране');
  for (const status of ['offline', 'rate-limited', 'no-data']) {
    assert.equal(phrase(null, 10, status), 'Нет данных Lichess — можно отметить вручную');
  }
  assert.equal(phrase(10, 10, 'ok', false), 'Норма набрана — отметка снята вручную');
  assert.equal(phrase(13, 10, 'ok', false), 'Норма набрана — отметка снята вручную');
  assert.equal(phrase(4, 10, 'no-permission'), 'Автоподсчёт выключен: подключите Lichess на основном экране');
  assert.equal(phrase(13, 10, 'no-permission', false), 'Автоподсчёт выключен: подключите Lichess на основном экране');
});

test('clock times are shown in Bishkek time', () => {
  assert.equal(formatClock('2026-10-12T03:14:00.000Z'), '09:14');
});

test('the card shows 4 / 10 with a bar, phrase and times', async () => {
  const commands = [];
  const f = fixture(async command => { commands.push(command); return reading(); });
  await f.card.refresh();
  assert.deepEqual(commands, [{ type: 'puzzles.refresh' }]);
  assert.deepEqual([f.node('puzzle-solved').textContent, f.node('puzzle-solved').hidden], ['4 / ', false]);
  assert.deepEqual([f.node('puzzle-bar').max, f.node('puzzle-bar').value, f.node('puzzle-bar').hidden], [10, 4, false]);
  assert.equal(f.node('puzzle-phrase').textContent, 'Хорошее начало — осталось 6');
  assert.deepEqual([f.node('puzzle-meta').textContent, f.node('puzzle-meta').hidden], ['счёт с 09:14 · обновлено 10:02', false]);
  assert.equal(f.node('puzzle-progress').hidden, false);
});

test('the bar stops at the target and an automatic mark refreshes the rest of the popup', async () => {
  const f = fixture(async () => reading({ solved: 12, completed: true, source: 'auto', autoCompleted: true }));
  await f.card.refresh();
  assert.equal(f.node('puzzle-bar').value, 10);
  assert.equal(f.node('puzzle-phrase').textContent, 'Сверх нормы: 12 задач');
  assert.equal(f.autoCompletes(), 1);
});

test('without a reading the card hides numbers and explains the manual mode', async () => {
  const f = fixture(async () => reading({ status: 'no-permission', solved: null, baselineAt: null, observedAt: null }));
  await f.card.refresh();
  assert.deepEqual([f.node('puzzle-solved').hidden, f.node('puzzle-bar').hidden, f.node('puzzle-meta').hidden], [true, true, true]);
  assert.equal(f.node('puzzle-phrase').textContent, 'Автоподсчёт выключен: подключите Lichess на основном экране');
  assert.equal(f.node('puzzle-progress').hidden, false);
});

test('stale readings are marked and request failures are reported while the manual mode stays', async () => {
  const stale = fixture(async () => reading({ status: 'offline' }));
  await stale.card.refresh();
  assert.equal(stale.node('puzzle-meta').textContent, 'счёт с 09:14 · обновлено 10:02 · данные могли устареть');
  assert.deepEqual(stale.errors, []);
  const failing = fixture(async () => { throw new Error('Disk full'); });
  assert.equal(await failing.card.refresh(), null);
  assert.equal(failing.node('puzzle-phrase').textContent, 'Нет данных Lichess — можно отметить вручную');
  assert.deepEqual(failing.errors, ['Disk full']);
});

test('overlapping refreshes send one request', async () => {
  let requests = 0;
  const f = fixture(async () => { requests += 1; return reading(); });
  await Promise.all([f.card.refresh(), f.card.refresh()]);
  assert.equal(requests, 1);
});

test('revoked access keeps today\'s numbers and says why counting stopped', async () => {
  const f = fixture(async () => reading({ status: 'no-permission' }));
  await f.card.refresh();
  assert.deepEqual([f.node('puzzle-solved').textContent, f.node('puzzle-bar').hidden], ['4 / ', false]);
  assert.equal(f.node('puzzle-phrase').textContent, 'Автоподсчёт выключен: подключите Lichess на основном экране');
  assert.equal(f.node('puzzle-meta').textContent, 'счёт с 09:14 · обновлено 10:02 · данные могли устареть');
});

test('a manual undo after reaching the target does not promise XP', async () => {
  const f = fixture(async () => reading({ solved: 10, completed: false }));
  await f.card.refresh();
  assert.equal(f.node('puzzle-phrase').textContent, 'Норма набрана — отметка снята вручную');
});

test('a mark or undo elsewhere in the popup re-reads the card once', async () => {
  const replies = [reading({ solved: 10, completed: true }), reading({ solved: 10, completed: false })];
  const commands = [];
  const f = fixture(async command => { commands.push(command); return replies.shift(); });
  assert.equal(f.card.syncCompletion(true), null, 'nothing to compare before the first reading');
  await f.card.refresh();
  assert.equal(f.card.syncCompletion(true), null);
  await f.card.syncCompletion(false);
  assert.equal(commands.length, 2);
  assert.equal(f.node('puzzle-phrase').textContent, 'Норма набрана — отметка снята вручную');
});
