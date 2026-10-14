import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeZone, systemTimeZone } from '../extension/ui/time-zone.js';
import { mountProfileSetup, mountProfileSection, startWithProfile, timeZoneOptions, formatProfile } from '../extension/ui/profile.js';

test.afterEach(() => setTimeZone(systemTimeZone()));

function makeNode(tag = 'div') {
  const handlers = new Map();
  const attributes = {};
  return {
    tag, textContent: '', value: '', hidden: false, disabled: false, className: '', children: [], attributes,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { attributes[key] = value; },
    addEventListener(type, handler) { handlers.set(type, handler); },
    dispatch(type) { return handlers.get(type)?.({ preventDefault() { this.prevented = true; } }); },
  };
}
function fakeDocument(ids = []) {
  const nodes = new Map(ids.map(id => [id, makeNode()]));
  return { createElement: makeNode, getElementById: id => nodes.get(id) };
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const byId = (root, id) => walk(root).find(item => item.id === id);
const allText = (root) => walk(root).map(item => item.textContent).join(' ');
const client = (handler) => { const calls = []; return { calls, async request(command) { calls.push(command); return handler(command); } }; };
const reloads = () => { const state = { count: 0 }; return { state, location: { reload() { state.count += 1; } } }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the time zone list has the system zone and UTC even when the browser omits them', () => {
  const zones = timeZoneOptions(['Europe/Paris', 'Asia/Bishkek'], 'Pacific/Fiji');
  assert.deepEqual(zones, ['Asia/Bishkek', 'Europe/Paris', 'Pacific/Fiji', 'UTC']);
  assert.deepEqual(timeZoneOptions(['UTC', 'Asia/Bishkek'], 'UTC'), ['Asia/Bishkek', 'UTC']);
  assert.ok(timeZoneOptions().includes(systemTimeZone()));
});

test('without a profile only the form is shown and nothing else is mounted', async () => {
  const document = fakeDocument();
  const container = makeNode('section');
  container.hidden = true;
  const { location } = reloads();
  const mounted = [];
  const fake = client(async () => ({ profile: null }));
  const result = await startWithProfile({ client: fake, container, document, location, mount: profile => mounted.push(profile) });
  assert.equal(result, null);
  assert.deepEqual(mounted, []);
  assert.deepEqual(fake.calls, [{ type: 'profile.get' }]);
  assert.equal(container.hidden, false);
  assert.match(allText(container), /Ваш профиль Lichess/);
  assert.match(allText(container), /Логин на Lichess/);
  assert.equal(byId(container, 'profile-username').placeholder, 'например, magnus_fan');
  assert.equal(byId(container, 'profile-time-zone').value, systemTimeZone());
});

test('with a profile the page zone is set and the rest is mounted once', async () => {
  const container = makeNode('section');
  container.hidden = true;
  const mounted = [];
  const profile = { username: 'magnus_fan', timeZone: 'America/New_York' };
  const result = await startWithProfile({ client: client(async () => ({ profile })), container, document: fakeDocument(), mount: value => mounted.push(value) });
  assert.deepEqual(result, profile);
  assert.deepEqual(mounted, [profile]);
  assert.equal(container.hidden, true);
  const { currentTimeZone } = await import('../extension/ui/time-zone.js');
  assert.equal(currentTimeZone(), 'America/New_York');
});

test('a failed profile.get is shown and nothing is mounted', async () => {
  const container = makeNode('section');
  const mounted = [];
  const result = await startWithProfile({ client: client(async () => { throw new Error('Хранилище недоступно'); }), container, document: fakeDocument(), mount: () => mounted.push(1) });
  assert.equal(result, null);
  assert.deepEqual(mounted, []);
  assert.equal(container.hidden, false);
  assert.match(allText(container), /Хранилище недоступно/);
});

test('submitting sends profile.setup with the typed values and reloads the page', async () => {
  const container = makeNode('section');
  const fake = client(async () => ({ profile: { username: 'magnus_fan', timeZone: 'America/New_York' } }));
  const { state, location } = reloads();
  const form = mountProfileSetup({ client: fake, container, document: fakeDocument(), location, zones: ['America/New_York', 'Asia/Bishkek'], system: 'Asia/Bishkek' });
  assert.equal(form.timeZone.value, 'Asia/Bishkek');
  form.username.value = '  Magnus_Fan ';
  form.timeZone.value = 'America/New_York';
  await form.form.dispatch('submit');
  assert.deepEqual(fake.calls, [{ type: 'profile.setup', username: 'Magnus_Fan', timeZone: 'America/New_York' }]);
  assert.equal(state.count, 1);
  assert.equal(form.error.hidden, true);
});

test('a refused setup shows the error, keeps the form usable and does not reload', async () => {
  const container = makeNode('section');
  const fake = client(async () => { throw new Error('Логин Lichess: 2–30 символов, латинские буквы, цифры, «_» и «-».'); });
  const { state, location } = reloads();
  const form = mountProfileSetup({ client: fake, container, document: fakeDocument(), location, zones: ['UTC'], system: 'UTC' });
  form.username.value = '-x';
  await form.form.dispatch('submit');
  assert.equal(form.error.hidden, false);
  assert.match(form.error.textContent, /Логин Lichess/);
  assert.equal(form.submit.disabled, false);
  assert.equal(state.count, 0);
});

function section(handler) {
  const document = fakeDocument(['profile-summary', 'profile-reset-word', 'profile-reset', 'profile-reset-error']);
  const fake = client(handler);
  const { state, location } = reloads();
  const busy = [];
  mountProfileSection({ client: fake, profile: { username: 'magnus_fan', timeZone: 'America/New_York' }, document, location, setExternalBusy: value => busy.push(value) });
  return { fake, state, busy, element: id => document.getElementById(id) };
}

test('the profile section shows the login and the zone', () => {
  const { element } = section(async () => ({ profile: null }));
  assert.match(element('profile-summary').textContent, /^Логин: magnus_fan · Часовой пояс: America\/New_York \(GMT-[45]\)$/);
  assert.equal(formatProfile({ username: 'a1', timeZone: 'Asia/Bishkek' }), 'Логин: a1 · Часовой пояс: Asia/Bishkek (GMT+6)');
});

test('the reset sends the normalized word and reloads', async () => {
  const { fake, state, element } = section(async () => ({ profile: null }));
  element('profile-reset-word').value = '  УДАЛИТЬ ';
  await element('profile-reset').dispatch('click');
  assert.deepEqual(fake.calls, [{ type: 'profile.reset', confirm: 'удалить' }]);
  assert.equal(state.count, 1);
});

test('a wrong word sends nothing, shows a hint and keeps the data', async () => {
  const { fake, state, element } = section(async () => ({ profile: null }));
  for (const wrong of ['', 'удалить!', 'delete']) {
    element('profile-reset-word').value = wrong;
    await element('profile-reset').dispatch('click');
    assert.equal(element('profile-reset-error').hidden, false);
    assert.match(element('profile-reset-error').textContent, /слово «удалить»/);
  }
  assert.deepEqual(fake.calls, []);
  assert.equal(state.count, 0);
});

test('a failed reset is shown and the button works again', async () => {
  let fail = true;
  const { fake, state, element } = section(async () => { if (fail) throw new Error('Не удалось очистить хранилище'); return { profile: null }; });
  element('profile-reset-word').value = 'удалить';
  await element('profile-reset').dispatch('click');
  assert.match(element('profile-reset-error').textContent, /Не удалось очистить/);
  assert.equal(element('profile-reset').disabled, false);
  assert.equal(state.count, 0);
  fail = false;
  await element('profile-reset').dispatch('click');
  await settle();
  assert.equal(fake.calls.length, 2);
  assert.equal(state.count, 1);
});

test('the main screen and popup hold the profile markup and no login of the first user', async () => {
  const read = name => readFile(new URL(`../extension/ui/${name}`, import.meta.url), 'utf8');
  const [dashboard, popup, manifest] = await Promise.all([read('dashboard.html'), read('popup.html'), readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')]);
  for (const id of ['profile-setup', 'profile-summary', 'profile-reset-word', 'profile-reset', 'profile-reset-error']) assert.match(dashboard, new RegExp(`id="${id}"`));
  assert.match(dashboard, /<title>Шахматный журнал<\/title>/);
  assert.match(popup, /Укажите свой логин Lichess на основном экране/);
  for (const text of [dashboard, popup, manifest]) assert.doesNotMatch(text, /sebajun777|Бишкек/);
});
