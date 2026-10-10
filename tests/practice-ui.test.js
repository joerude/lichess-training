import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPractice } from '../extension/ui/practice.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const base = () => ({ date: '2026-10-06', program: { startedOn: '2026-10-06', revision: 1, targets: { bullet: 5, blitz: 5, rapid: 0, puzzles: 10, reviews: 1 }, pending: null }, tasks: [{ id: 'bullet', current: 2, target: 5, completed: false, source: 'games' }, { id: 'puzzles', current: 10, target: 10, completed: true, source: 'manual' }], rewards: { totalXp: 20, level: 1, nextLevelXp: 100, gainedToday: 20 }, week: [{ date: '2026-10-06', scheduled: true, completed: false }], coverage: { partial: true }, reviewOptions: [{ id: 'game0001', speed: 'bullet', result: 'win', createdAt: 1 }], reviews: [] });
function fixture(request, compact = false) {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); }, createElement: () => makeNode(), createDocumentFragment: () => makeNode() };
  function makeNode() { const handlers = new Map(); return { textContent: '', value: '', children: [], hidden: false, disabled: false, attributes: {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, handler) { handlers.set(type, handler); }, dispatch(type) { return handlers.get(type)?.({ preventDefault() {} }); } }; }
  const busy = [];
  const mounted = mountPractice({ client: { request }, document, compact, setExternalBusy: (value) => busy.push(value) });
  return { mounted, element: (id) => document.getElementById(id), busy };
}
const allText = (node) => [node.textContent, ...node.children.map(allText)].join(' ');

test('mounted dashboard shows raw task counts, partial coverage, XP, week and compact popup summary', async () => {
  for (const compact of [false, true]) {
    const { mounted, element } = fixture(async () => base(), compact);
    await mounted.refresh();
    assert.match(element('program-summary').textContent, /1 из 2/);
    assert.match(element('program-summary').textContent, /20 XP.*1/);
    if (!compact) assert.match(element('program-level').textContent, /100 XP/);
    if (!compact) {
      assert.match(allText(element('program-tasks')), /2 из 5/);
      assert.match(allText(element('program-tasks')), /неполная/);
      assert.equal(element('program-week').children.length, 1);
      assert.match(element('program-xp-note').textContent, /без истории/);
    }
  }
});

test('complete coverage shows the load time in Asia/Bishkek', async () => {
  const value = { ...base(), coverage: { coverageStart: 0, completedUntil: Date.parse('2026-10-06T06:30:00Z'), partial: false } };
  const { mounted, element } = fixture(async () => value);
  await mounted.refresh();
  const text = allText(element('program-tasks'));
  assert.match(text, /Из сохранённых завершённых rated standard партий, загруженных до 12:30\./);
  assert.doesNotMatch(text, /неполная/);
});

test('future target draft retains original day and revision through refresh and failed save', async () => {
  let current = base();
  const commands = [];
  const { mounted, element } = fixture(async (command) => { commands.push(command); if (command.type === 'program.configure') throw new Error('День изменился'); return current; });
  await mounted.refresh();
  element('goal-bullet').value = '7';
  element('goal-bullet').dispatch('input');
  current = { ...base(), date: '2026-10-07', program: { ...base().program, revision: 2 } };
  await mounted.refresh();
  await element('goals-form').dispatch('submit');
  assert.deepEqual(commands.at(-1), { type: 'program.configure', day: '2026-10-06', expectedRevision: 1, targets: { bullet: 7, blitz: 5, rapid: 0, puzzles: 10, reviews: 1 } });
  assert.equal(element('goal-bullet').value, '7');
  assert.match(element('goals-error').textContent, /День изменился/);
  await mounted.refresh();
  assert.equal(element('goals-error').hidden, false);
});

test('review create, edit, failed revision save, retained draft and delete use explicit versions', async () => {
  const commands = [];
  let current = base(), fail = false;
  const { mounted, element } = fixture(async (command) => {
    commands.push(command);
    if (command.type === 'program.saveReview') {
      if (fail) throw new Error('Версия изменилась');
      current = { ...current, reviews: [{ gameId: command.gameId, note: command.note, date: '2026-10-06', revision: 3 }] };
    }
    if (command.type === 'program.deleteReview') current = { ...current, reviews: [] };
    return current;
  });
  await mounted.refresh();
  element('review-game').value = 'game0001';
  element('review-game').dispatch('input');
  element('review-note').value = '<script>мой разбор</script>';
  element('review-note').dispatch('input');
  await mounted.refresh();
  assert.equal(element('review-note').value, '<script>мой разбор</script>');
  await element('review-form').dispatch('submit');
  assert.deepEqual(commands.at(-1), { type: 'program.saveReview', day: '2026-10-06', gameId: 'game0001', note: '<script>мой разбор</script>', expectedRevision: null });
  const entry = element('review-list').children[0];
  assert.equal(entry.children[1].textContent, '<script>мой разбор</script>');
  assert.equal(entry.children[0].href, 'https://lichess.org/game0001');
  entry.children[3].children[0].dispatch('click');
  element('review-note').value = 'Новая правка';
  element('review-note').dispatch('input');
  current = { ...current, reviews: [{ ...current.reviews[0], revision: 4, note: 'Другое окно' }] };
  await mounted.refresh();
  fail = true;
  await element('review-form').dispatch('submit');
  assert.equal(commands.at(-1).expectedRevision, 3);
  assert.equal(element('review-note').value, 'Новая правка');
  assert.match(element('review-error').textContent, /Версия изменилась/);
  fail = false;
  await element('review-list').children[0].children[3].children[1].dispatch('click');
  assert.deepEqual(commands.at(-1), { type: 'program.deleteReview', day: '2026-10-06', gameId: 'game0001', expectedRevision: 4 });
  assert.equal(element('review-list').children.length, 0);
  assert.equal(element('review-error').hidden, false, 'deletion must not clear the failed edit error');
});

test('failed reads preserve mounted facts and balanced external busy state', async () => {
  let fail = false;
  const { mounted, element, busy } = fixture(async () => { if (fail) throw new Error('Нет доступа'); return base(); });
  await mounted.refresh();
  fail = true;
  await mounted.refresh();
  assert.match(element('program-summary').textContent, /20 XP/);
  assert.match(element('program-error').textContent, /Нет доступа/);
  assert.deepEqual(busy, [true, false, true, false]);
});

test('review draft keeps its displayed day at midnight and serialized refresh cannot rebase a queued save', async () => {
  let next = base(), finishRead;
  const commands = [];
  const { mounted, element, busy } = fixture((command) => {
    commands.push(command);
    if (command.type === 'program.saveReview') return Promise.reject(new Error('Тренировочный день изменился'));
    if (commands.length === 1) return Promise.resolve(next);
    return new Promise((resolve) => { finishRead = resolve; });
  });
  await mounted.refresh();
  element('review-game').value = 'game0001';
  element('review-game').dispatch('input');
  element('review-note').value = 'Черновик перед полуночью';
  element('review-note').dispatch('input');
  const read = mounted.refresh();
  await settle();
  const write = element('review-form').dispatch('submit');
  const duplicate = element('review-form').dispatch('submit');
  assert.equal(duplicate, undefined, 'a second submission while writing is ignored');
  assert.equal(commands.length, 2, 'the write waits for the earlier read');
  next = { ...next, date: '2026-10-07' };
  finishRead(next);
  await read;
  await write;
  assert.deepEqual(commands.at(-1), { type: 'program.saveReview', day: '2026-10-06', expectedRevision: null, gameId: 'game0001', note: 'Черновик перед полуночью' });
  assert.equal(element('review-note').value, 'Черновик перед полуночью');
  assert.equal(element('review-error').hidden, false);
  assert.deepEqual(busy, [true, false, true, false]);
  assert.equal(element('review-save').disabled, false);
});
