import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The main screen is plain markup, so its contract with the scripts is checked on the text of the page.
const read = (name) => readFile(new URL(`../extension/ui/${name}`, import.meta.url), 'utf8');
const page = await read('dashboard.html');
const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const section = (pattern) => pattern.exec(page)?.[0] ?? '';

test('every id on the main screen is unique', () => {
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
});

test('label for, aria-describedby and aria-labelledby point at elements that exist', () => {
  const references = [...page.matchAll(/\s(?:for|aria-describedby|aria-labelledby)="([^"]+)"/g)].flatMap((match) => match[1].split(' '));
  assert.ok(references.length >= 15);
  assert.deepEqual(references.filter((id) => !ids.includes(id)), []);
});

test('every id the main screen scripts read is in the markup', async () => {
  const wanted = new Set(['sync-bullet', 'sync-blitz', 'sync-rapid', ...['bullet', 'blitz', 'rapid', 'puzzles', 'reviews'].map((id) => `goal-${id}`)]);
  for (const name of ['dashboard.js', 'page.js', 'practice.js', 'history.js', 'history-view.js', 'sync.js']) {
    const source = await read(name);
    for (const match of source.matchAll(/(?:getElementById|element|find)\('([^']+)'\)/g)) wanted.add(match[1]);
    for (const match of source.matchAll(/querySelector\('#([\w-]+)/g)) wanted.add(match[1]);
  }
  assert.ok(wanted.size > 60);
  assert.deepEqual([...wanted].filter((id) => !ids.includes(id)), []);
});

test('every hint is a details element with a labelled "?" and a body', () => {
  const hints = [...page.matchAll(/<details class="hint">(.*?)<\/details>/gs)].map((match) => match[1]);
  assert.ok(hints.length >= 10);
  for (const hint of hints) assert.match(hint, /^<summary aria-label="Подробнее">\?<\/summary><div[^>]* class="hint-body"/);
  for (const id of ['sync-permission-description', 'review-game-hint', 'review-note-hint', 'review-mode', 'program-start', 'program-xp-note']) {
    assert.ok(hints.some((hint) => hint.includes(`id="${id}"`)), `${id} sits in a hint`);
  }
});

test('the rating series choice is a group of four buttons with Bullet pressed', () => {
  const group = /<div id="history-rating-series" class="segmented" role="group" aria-label="Серия рейтинга">(.*?)<\/div>/.exec(page);
  assert.ok(group, 'the group has the expected role and label');
  const buttons = [...group[1].matchAll(/<button type="button" data-series="(\w+)" aria-pressed="(\w+)">([^<]+)<\/button>/g)].map((match) => match.slice(1));
  assert.deepEqual(buttons, [['Bullet', 'true', 'Bullet'], ['Blitz', 'false', 'Blitz'], ['Rapid', 'false', 'Rapid'], ['Puzzles', 'false', 'Задачи']]);
});

test('the long blocks are folded and the removed blocks are gone', () => {
  assert.match(page, /<details class="fold">\s*<summary>Подробнее о загрузке<\/summary>\s*<dl class="sync-metadata">[\s\S]*?id="sync-coverage"[\s\S]*?id="sync-completed"[\s\S]*?id="sync-last-success"[\s\S]*?<\/dl>/);
  assert.match(page, /<details class="fold history-import">\s*<summary>Добавить историю из файлов<\/summary>/);
  assert.match(section(/<section id="today-card".*?<\/section>/s), /Всего дней с отметкой: <span id="completed-days">/);
  for (const gone of ['Время сделать ход', 'Начните с малого', 'Ритм практики', 'Отметок тактики', 'id="week"', 'id="week-summary"', '<select']) {
    assert.equal(page.includes(gone), false, gone);
  }
});
