// Smoke check of the packaged extension in a real headless Firefox, driven over Marionette (no geckodriver).
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, rmSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.FIREFOX_SMOKE_PORT ?? 2831);
const ORIGIN = 'https://lichess.org/*';
const TIME_ZONE = 'Asia/Bishkek';
const MIN_FIREFOX = 140;

// Texts of the extension that the checks compare against.
const NO_ACCESS = 'Автоподсчёт выключен: подключите Lichess на основном экране';
const MANUAL = '✓ Тренировка выполнена';
const OPEN = '○ Сегодня ещё не отмечено';
const COUNTED = '✓ Засчитано по счётчику Lichess';
const REACHED = 'Норма выполнена! +20 XP';
const UNDONE = 'Норма набрана — отметка снята вручную';
const DASHBOARD_NOTE = 'Засчитано автоматически по счётчику задач Lichess.';
const DASHBOARD_CAPTION = 'Автоподсчёт по профилю Lichess или отметка вручную';
const STALE = 'данные могли устареть';
const CONNECT = 'Подключить Lichess';
const REFRESH = 'Обновить с Lichess';

const SCENARIOS = [
  { name: 'basic', network: false, run: basic, title: 'popup без доступа, ручная отметка и её отмена' },
  { name: 'dialog', network: true, run: dialog, title: 'настоящий диалог разрешения и первая загрузка' },
  { name: 'auto', network: true, run: auto, title: 'автозачёт по счётчику, отмена и запрет возврата' },
  { name: 'backup', network: true, run: backup, title: 'экспорт и восстановление копии после автозачёта' },
  { name: 'network', network: true, run: networkLoss, title: 'обрыв сети и пометка «данные могли устареть»' },
  { name: 'keys', network: false, run: keys, title: 'порядок Tab и Enter в popup' },
  { name: 'dashboard', network: true, run: dashboardFirst, title: 'показание, снятое основным экраном без popup' },
];

const HELP = `Проверка расширения в настоящем Firefox (headless, Marionette, без geckodriver).

Использование: node scripts/firefox-smoke.mjs [--only=имена] [--no-network] [--help]
Через npm: npm run smoke:firefox -- --only=basic,keys

Нужны Firefox ${MIN_FIREFOX}+ в PATH и пакет dist/lichess-training-<версия>.zip (npm run smoke:firefox собирает его сам).
Каждый сценарий идёт в свежем временном профиле; профиль Firefox пользователя не затрагивается.
Профиль удаляется, скриншоты, загрузки и report.json остаются во временном каталоге, путь печатается в конце.

Параметры:
  --only=имена   запустить только перечисленные сценарии (через запятую)
  --no-network   пропустить сценарии, которые ходят в Lichess (все, кроме basic и keys)
  --help         показать эту справку

Сценарии:
${SCENARIOS.map(scenario => `  ${scenario.name.padEnd(10)}${scenario.title}${scenario.network ? ' (сеть)' : ''}`).join('\n')}

ВНИМАНИЕ: сценарии dialog, auto, backup, network и dashboard делают несколько реальных запросов
к публичному API Lichess (счётчик задач профиля, загрузка партий). Без сети используйте --no-network.
Не запускайте проверку около полуночи по Бишкеку (UTC+6): день в расширении сменится посреди сценария.

Переменная FIREFOX_SMOKE_PORT задаёт порт Marionette (по умолчанию 2831).
Код выхода: 0, если все проверки прошли; 1 при провалах, исключениях и неверных аргументах.
`;

let current = null;
let active = null;
const report = { startedAt: new Date().toISOString(), browser: null, total: 0, failed: 0, scenarios: [] };

function check(name, condition, details = '') {
  const ok = Boolean(condition);
  const text = typeof details === 'string' ? details : JSON.stringify(details);
  report.total += 1;
  if (!ok) report.failed += 1;
  current.checks.push({ name, ok, details: text });
  console.log(`${ok ? '✓' : '✗'} ${name}${text ? ` — ${text}` : ''}`);
}

const show = value => JSON.stringify(value);
const xp = summary => Number(/(\d+) XP/.exec(summary ?? '')?.[1]);
const secondsSince = iso => (Date.now() - Date.parse(iso)) / 1000;
const isTwoMinutes = seconds => seconds >= 119 && seconds < 135;
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

function dayOf(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const field = type => parts.find(part => part.type === type).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

class ConnectionClosed extends Error {}

// Marionette frames are "<byte length>:<json>"; commands are [0, id, name, params], replies [1, id, error, result].
class Marionette {
  static open(port, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const client = new Marionette(socket);
      const timer = setTimeout(() => fail(new Error('Marionette не прислал приветствие.')), timeout);
      const fail = error => { clearTimeout(timer); socket.destroy(); reject(error); };
      socket.once('error', fail);
      client.hello.then(() => { clearTimeout(timer); socket.off('error', fail); resolve(client); }, fail);
    });
  }

  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.lastId = 0;
    this.pending = new Map();
    this.closed = null;
    this.hello = new Promise((resolve, reject) => { this.greet = resolve; this.refuse = reject; });
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on('error', error => this.shutdown(new ConnectionClosed(error.message)));
    socket.on('close', () => this.shutdown(new ConnectionClosed('Соединение с Marionette закрыто.')));
  }

  drain() {
    for (;;) {
      const colon = this.buffer.indexOf(':');
      if (colon < 0) return;
      const end = colon + 1 + Number(this.buffer.subarray(0, colon));
      if (this.buffer.length < end) return;
      const message = JSON.parse(this.buffer.subarray(colon + 1, end).toString('utf8'));
      this.buffer = this.buffer.subarray(end);
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (!Array.isArray(message)) { this.greet(message); return; }
    const [, id, error, result] = message;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(new Error(`${entry.name}: ${error.error}: ${error.message}`));
    else entry.resolve(result);
  }

  shutdown(error) {
    this.closed ??= error;
    this.refuse(error);
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }

  command(name, params = {}, timeout = 60_000) {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.lastId;
    const body = Buffer.from(JSON.stringify([0, id, name, params]));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${name}: нет ответа за ${timeout / 1000} с`));
      }, timeout);
      this.pending.set(id, { name, resolve, reject, timer });
      this.socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]));
    });
  }

  // Runs a function in the current context and returns its JSON result. The function is serialised, so it cannot use this module.
  async run(fn, ...args) {
    const script = `const done = arguments[arguments.length - 1], args = arguments[0];
      Promise.resolve().then(() => (${fn})(...args)).then(
        value => done(JSON.stringify({ value })),
        error => done(JSON.stringify({ error: String((error && error.message) || error) })));`;
    const reply = await this.command('WebDriver:ExecuteAsyncScript', { script, args: [args] });
    const result = JSON.parse(reply.value);
    if (result.error) throw new Error(result.error);
    return result.value;
  }

  async chrome(fn, ...args) {
    await this.command('Marionette:SetContext', { value: 'chrome' });
    try { return await this.run(fn, ...args); }
    finally { await this.command('Marionette:SetContext', { value: 'content' }); }
  }

  navigate(url) { return this.command('WebDriver:Navigate', { url }); }

  async element(selector) {
    const { value } = await this.command('WebDriver:FindElement', { using: 'css selector', value: selector });
    return Object.values(value)[0];
  }

  async click(selector) { await this.command('WebDriver:ElementClick', { id: await this.element(selector) }); }

  async sendKeys(selector, text) { await this.command('WebDriver:ElementSendKeys', { id: await this.element(selector), text }); }

  async press(key) {
    const actions = [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: key }, { type: 'keyUp', value: key }] }];
    await this.command('WebDriver:PerformActions', { actions });
    await this.command('WebDriver:ReleaseActions');
    await sleep(300);
  }

  close() { this.socket.destroy(); }
}

const KEYS = { tab: '\uE004', enter: '\uE007' };

// Browser-side functions: serialised by Marionette.run, they run inside Firefox and cannot see this module.
const readPopup = () => {
  const text = id => document.getElementById(id)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  const hidden = id => document.getElementById(id)?.hidden ?? null;
  const bar = document.getElementById('puzzle-bar');
  return {
    target: text('target'), solved: text('puzzle-solved'), solvedHidden: hidden('puzzle-solved'),
    phrase: text('puzzle-phrase'), meta: text('puzzle-meta'), metaHidden: hidden('puzzle-meta'),
    barHidden: bar?.hidden ?? null, barValue: bar?.value ?? null, progressHidden: hidden('puzzle-progress'),
    status: text('today-status'), button: text('completion'), summary: text('program-summary'),
    controlsDisabled: Boolean(document.getElementById('completion')?.disabled || document.getElementById('refresh')?.disabled),
    error: document.getElementById('error')?.hidden === false ? text('error') : null,
  };
};

const readDashboard = () => {
  const text = node => node?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  const byId = id => document.getElementById(id);
  const tasks = [...document.querySelectorAll('#program-tasks > li')].map(item => [...item.children].map(text).join(' '));
  return {
    caption: text(document.querySelector('#today-card .caption')), tasks, puzzleTask: tasks.find(task => task.startsWith('Задачи')) ?? null,
    status: text(byId('today-status')), summary: text(byId('program-summary')),
    syncRun: text(byId('sync-run')), syncError: byId('sync-error')?.hidden === false ? text(byId('sync-error')) : null,
    error: byId('error')?.hidden === false ? text(byId('error')) : null,
    controlsDisabled: Boolean(byId('completion')?.disabled || byId('export')?.disabled || byId('refresh')?.disabled),
    restoreOpen: byId('restore-dialog')?.open ?? null,
    restorePreview: [...document.querySelectorAll('#backup-preview dt')].map(term => `${text(term)}: ${text(term.nextElementSibling)}`).join('; '),
  };
};

const readFocus = () => {
  const node = document.activeElement;
  return { tag: node.tagName.toLowerCase(), id: node.id, text: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
};

const clickById = id => document.getElementById(id).click();

// Reads the stored puzzle reading. 'observed' ages it by two minutes; 'baseline' also puts the baseline ten below the latest count.
const editReading = async change => {
  const db = await new Promise(resolve => {
    const request = indexedDB.open('lichess-training');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('historyMeta', change ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('historyMeta');
      const request = store.get('puzzles');
      let saved = null;
      request.onsuccess = () => {
        saved = request.result ?? null;
        if (saved && change) {
          const earlier = new Date(Date.now() - 120000).toISOString();
          saved = { ...saved, observedAt: earlier, ...(change === 'baseline' ? { baseline: saved.latest - 10, baselineAt: earlier } : {}) };
          store.put(saved, 'puzzles');
        }
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onabort = () => reject(new Error('транзакция IndexedDB прервана'));
    });
  } finally { db.close(); }
};

// Returns the permissions the add-on holds; with an origin it first grants access to it, as the dialog would.
const permissionsOf = async (addonId, origin) => {
  const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
  if (origin) {
    const grant = { permissions: [], origins: [origin], data_collection: ['authenticationInfo'] };
    await ExtensionPermissions.add(addonId, grant, WebExtensionPolicy.getByID(addonId).extension);
  }
  return ExtensionPermissions.get(addonId);
};

const hostOf = addonId => WebExtensionPolicy.getByID(addonId).mozExtensionHostname;

// Presses the main button of the permission doorhanger, if it is shown.
const answerPrompt = () => {
  const panel = PopupNotifications.panel;
  const node = panel?.querySelector('popupnotification');
  if (!node?.button) return null;
  const info = { id: node.id, panelState: panel.state, button: node.button.label, text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) };
  node.button.click();
  return info;
};

const switchProxy = enabled => {
  const prefs = Services.prefs;
  prefs.setIntPref('network.proxy.type', enabled ? 1 : 0);
  if (enabled) {
    for (const kind of ['ssl', 'http']) {
      prefs.setStringPref(`network.proxy.${kind}`, '127.0.0.1');
      prefs.setIntPref(`network.proxy.${kind}_port`, 9);
    }
  }
  return {
    type: prefs.getIntPref('network.proxy.type'),
    ssl: prefs.getStringPref('network.proxy.ssl', ''), sslPort: prefs.getIntPref('network.proxy.ssl_port', 0),
    http: prefs.getStringPref('network.proxy.http', ''), httpPort: prefs.getIntPref('network.proxy.http_port', 0),
  };
};

// Polls until accept(read()) holds or the time is up; returns the last value either way.
async function until(read, accept, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let value;
  let failure = null;
  for (;;) {
    try {
      value = await read();
      if (accept(value)) return value;
    } catch (error) {
      if (error instanceof ConnectionClosed) throw error;
      failure = error;
    }
    if (Date.now() >= deadline) break;
    await sleep(250);
  }
  if (value === undefined && failure) throw failure;
  return value;
}

const popupReady = state => state.progressHidden === false && !state.controlsDisabled &&
  Boolean(state.status) && !state.status.startsWith('Загружаем') && Boolean(state.summary) && state.summary !== 'Загрузка…';
const dashboardReady = state => !state.controlsDisabled && state.tasks.length > 0 &&
  Boolean(state.status) && !state.status.startsWith('Загружаем') && Boolean(state.summary) && !state.summary.startsWith('Загружаем');

class Session {
  constructor(m, { name, addonId, base, downloads, screenshots }) {
    Object.assign(this, { m, name, addonId, base, downloads, screenshots, today: dayOf(new Date()), steps: 0 });
  }

  async watch(read, ready, accept, timeout, kind) {
    const state = await until(() => this.m.run(read), value => ready(value) && accept(value), timeout);
    current.states[`${kind}-${++this.steps}`] = state;
    return state;
  }

  watchPopup(accept = () => true, timeout = 30_000) { return this.watch(readPopup, popupReady, accept, timeout, 'popup'); }

  watchDashboard(accept = () => true, timeout = 30_000) { return this.watch(readDashboard, dashboardReady, accept, timeout, 'dashboard'); }

  async popup(accept, timeout) {
    await this.m.navigate(`${this.base}/popup.html`);
    return this.watchPopup(accept, timeout);
  }

  async dashboard(accept, timeout) {
    await this.m.navigate(`${this.base}/dashboard.html`);
    return this.watchDashboard(accept, timeout);
  }

  async click(id) { await this.m.run(clickById, id); }

  async grant() {
    const granted = await this.m.chrome(permissionsOf, this.addonId, ORIGIN);
    if (!granted.origins.includes(ORIGIN) || !granted.data_collection.includes('authenticationInfo')) {
      throw new Error(`Разрешение не выдано: ${show(granted)}`);
    }
  }

  async reading(change) {
    const value = await this.m.run(editReading, change);
    if (change && !value) throw new Error('В IndexedDB нет показания счётчика задач (historyMeta, ключ puzzles).');
    return value;
  }

  async shot(label) {
    try {
      const { value } = await this.m.command('WebDriver:TakeScreenshot', { full: true });
      const file = join(this.screenshots, `${this.name}-${label}.png`);
      await writeFile(file, Buffer.from(value, 'base64'));
      current.screenshots.push(file);
    } catch {
      // A missing screenshot is not a failed check.
    }
  }
}

// Gives access without the dialog, takes the day's first reading, moves its baseline ten below and reopens the popup.
async function autoComplete(s) {
  await s.grant();
  const first = await s.popup(state => !state.solvedHidden);
  const shifted = await s.reading('baseline');
  const ages = { baselineAt: secondsSince(shifted.baselineAt), observedAt: secondsSince(shifted.observedAt) };
  const marked = await s.popup(state => state.phrase === REACHED && state.status === COUNTED);
  return { first, shifted, ages, marked };
}

async function basic(s) {
  const start = await s.popup();
  await s.shot('popup-no-access');
  check('popup без доступа: фраза про выключенный автоподсчёт', start.phrase === NO_ACCESS, show(start.phrase));
  check('popup без доступа: числа скрыты', start.solvedHidden && start.barHidden && start.metaHidden,
    `число ${start.solvedHidden}, полоса ${start.barHidden}, подпись ${start.metaHidden}`);
  await s.click('completion');
  const marked = await s.watchPopup(state => state.status === MANUAL);
  check('ручная отметка: статус «✓ Тренировка выполнена»', marked.status === MANUAL, show(marked.status));
  check('ручная отметка: 20 XP в строке программы', xp(marked.summary) === 20, show(marked.summary));
  await s.click('completion');
  const undone = await s.watchPopup(state => state.status === OPEN);
  check('отмена отметки: 0 XP в строке программы', undone.status === OPEN && xp(undone.summary) === 0, show(undone.summary));
  const board = await s.dashboard();
  await s.shot('dashboard');
  check('основной экран: подпись об автоподсчёте или отметке вручную', board.caption?.includes(DASHBOARD_CAPTION), show(board.caption));
}

async function dialog(s) {
  const before = await s.dashboard(state => state.syncRun === CONNECT);
  check('основной экран без доступа: кнопка «Подключить Lichess»', before.syncRun === CONNECT, show(before.syncRun));
  await s.m.click('#sync-run');
  const prompt = await until(() => s.m.chrome(answerPrompt), found => found !== null, 20_000);
  current.states.prompt = prompt;
  check('Firefox показал запрос разрешения и кнопка нажата', prompt && /lichess\.org/.test(prompt.text),
    prompt ? `${prompt.id}, панель ${prompt.panelState}, кнопка «${prompt.button}»` : 'запрос не появился за 20 с');
  if (!prompt) return;
  const hasAccess = value => value.origins.includes(ORIGIN) && value.data_collection.includes('authenticationInfo');
  const granted = await until(() => s.m.chrome(permissionsOf, s.addonId), hasAccess, 10_000);
  check('ExtensionPermissions: origin https://lichess.org/*', granted.origins.includes(ORIGIN), show(granted));
  check('ExtensionPermissions: authenticationInfo', granted.data_collection.includes('authenticationInfo'), show(granted.data_collection));
  console.log('  … ждём загрузку партий с Lichess');
  const loaded = await until(() => s.m.run(readDashboard), state => state.syncRun === REFRESH && !state.controlsDisabled, 90_000);
  current.states.loaded = loaded;
  await s.shot('dashboard-connected');
  check('после загрузки кнопка «Обновить с Lichess»', loaded.syncRun === REFRESH, show(loaded.syncRun));
  check('после загрузки ошибки нет', loaded.syncError === null && loaded.error === null, show(loaded.syncError ?? loaded.error));
  const popup = await s.popup(state => !state.solvedHidden);
  await s.shot('popup');
  check('popup: число вида «0 / »', /^\d+ \/$/.test(popup.solved ?? ''), show(popup.solved));
  check('popup: строка «счёт с …»', /^счёт с \d\d:\d\d/.test(popup.meta ?? ''), show(popup.meta));
}

async function auto(s) {
  const { first, shifted, ages, marked } = await autoComplete(s);
  check('с доступом popup снимает показание: «0 / 10»', first.solved === '0 /' && first.target === '10', `${show(first.solved)} / ${show(first.target)}`);
  check('сдвиг в IndexedDB: baseline = latest − 10', shifted.baseline === shifted.latest - 10, `baseline ${shifted.baseline}, latest ${shifted.latest}`);
  check('сдвиг в IndexedDB: baselineAt и observedAt на 2 минуты раньше', Object.values(ages).every(isTwoMinutes),
    `${Math.round(ages.baselineAt)} с и ${Math.round(ages.observedAt)} с назад`);
  await s.shot('popup-counted');
  check('повторное открытие: «Норма выполнена! +20 XP»', marked.phrase === REACHED, show(marked.phrase));
  check('повторное открытие: «✓ Засчитано по счётчику Lichess»', marked.status === COUNTED, show(marked.status));
  const board = await s.dashboard(state => state.puzzleTask?.includes(DASHBOARD_NOTE));
  check('основной экран: «Засчитано автоматически по счётчику задач Lichess.»', board.puzzleTask?.includes(DASHBOARD_NOTE), show(board.puzzleTask));
  await s.popup(state => state.status === COUNTED);
  await s.click('completion');
  const undone = await s.watchPopup(state => state.phrase === UNDONE);
  await s.shot('popup-undone');
  check('отмена в том же popup: «Норма набрана — отметка снята вручную»', undone.phrase === UNDONE, show(undone.phrase));
  check('отмена в том же popup: 0 XP', undone.status === OPEN && xp(undone.summary) === 0, show(undone.summary));
  // The reading is aged so that the reopened popup asks Lichess again and could mark the day anew.
  await s.reading('observed');
  await s.popup();
  await sleep(1500);
  const reopened = await s.m.run(readPopup);
  const refreshed = secondsSince((await s.reading()).observedAt);
  check('повторное открытие после нового запроса: отметка не вернулась',
    refreshed < 60 && reopened.status === OPEN && reopened.phrase === UNDONE && xp(reopened.summary) === 0,
    `${show(reopened.status)}, ${show(reopened.summary)}, показание обновлено ${Math.round(refreshed)} с назад`);
}

async function backup(s) {
  const { marked } = await autoComplete(s);
  check('перед экспортом: автозачёт сработал', marked.status === COUNTED && xp(marked.summary) === 20, show(marked.summary));
  const board = await s.dashboard(state => state.status === COUNTED);
  if (board.status !== COUNTED) return;
  await s.click('export');
  const file = await until(async () => {
    const name = (await readdir(s.downloads)).find(entry => entry.endsWith('.json'));
    if (!name) return null;
    try { return { name, data: JSON.parse(await readFile(join(s.downloads, name), 'utf8')) }; } catch { return null; }
  }, value => value !== null, 20_000);
  check('экспорт: файл lichess-training-ГГГГ-ММ-ДД.json скачан', /^lichess-training-\d{4}-\d{2}-\d{2}\.json$/.test(file?.name ?? ''), show(file?.name ?? null));
  if (!file) return;
  const day = file.data.state?.days?.find(entry => entry.date === s.today);
  check('в копии у сегодняшнего дня source: "auto"', day?.source === 'auto', show(day ?? null));
  check('в копии нет ключа puzzles', !('puzzles' in file.data) && !('puzzles' in (file.data.state ?? {})), Object.keys(file.data).join(', '));
  await s.click('completion');
  const undone = await s.watchDashboard(state => state.status === OPEN);
  check('перед восстановлением: отметка снята, 0 XP', undone.status === OPEN && xp(undone.summary) === 0, show(undone.summary));
  await s.m.sendKeys('#backup-file', join(s.downloads, file.name));
  const preview = await s.watchDashboard(state => state.restoreOpen === true, 15_000);
  current.states.preview = preview.restorePreview;
  await s.shot('restore-dialog');
  check('выбор файла: диалог восстановления открыт', preview.restoreOpen === true, preview.restorePreview);
  if (preview.restoreOpen !== true) return;
  await s.click('replace');
  const restored = await s.watchDashboard(state => state.restoreOpen === false && state.status === COUNTED);
  check('после восстановления: «✓ Засчитано по счётчику Lichess»', restored.status === COUNTED, show(restored.status));
  check('после восстановления: 20 XP на основном экране', restored.restoreOpen === false && xp(restored.summary) === 20, show(restored.summary));
  const popup = await s.popup(state => state.status === COUNTED);
  check('после восстановления: popup показывает «✓ Засчитано…» и 20 XP', popup.status === COUNTED && xp(popup.summary) === 20,
    `${show(popup.status)}, ${show(popup.summary)}`);
}

async function networkLoss(s) {
  const { marked } = await autoComplete(s);
  check('до обрыва: автозачёт сработал', marked.status === COUNTED, show(marked.status));
  const proxy = await s.m.chrome(switchProxy, true);
  check('prefs прокси: network.proxy.type = 1, ssl и http на 127.0.0.1:9',
    proxy.type === 1 && proxy.ssl === '127.0.0.1' && proxy.sslPort === 9 && proxy.http === '127.0.0.1' && proxy.httpPort === 9, show(proxy));
  const aged = await s.reading('observed');
  const age = secondsSince(aged.observedAt);
  check('observedAt сдвинут на 2 минуты назад', isTwoMinutes(age), `${Math.round(age)} с назад`);
  const offline = await s.popup(state => state.meta?.endsWith(STALE), 40_000);
  await s.shot('popup-offline');
  check('без сети: подпись заканчивается на «данные могли устареть»', offline.meta?.endsWith(STALE), show(offline.meta));
  const restored = await s.m.chrome(switchProxy, false);
  check('network.proxy.type = 0', restored.type === 0, show(restored.type));
  const online = await s.popup(state => state.metaHidden === false && !state.meta.includes(STALE), 40_000);
  await s.shot('popup-online');
  check('после возврата сети: подпись без пометки «данные могли устареть»', online.metaHidden === false && !online.meta.includes(STALE), show(online.meta));
}

async function keys(s) {
  const describe = focus => (focus.tag === 'a' ? `a «${focus.text}»` : `${focus.tag}#${focus.id}`);
  await s.popup();
  const order = [];
  for (let step = 0; step < 4; step++) {
    await s.m.press(KEYS.tab);
    order.push(await s.m.run(readFocus));
  }
  const [refresh, link, completion, dashboard] = order;
  check('порядок Tab: ↻, «Открыть задачи», кнопка отметки, «Открыть полный журнал»',
    refresh.id === 'refresh' && link.tag === 'a' && link.text.startsWith('Открыть задачи') && completion.id === 'completion' && dashboard.id === 'open-dashboard',
    order.map(describe).join(' → '));
  await s.popup();
  for (let step = 0; step < 3; step++) await s.m.press(KEYS.tab);
  const focus = await s.m.run(readFocus);
  check('после 3×Tab фокус на кнопке отметки', focus.id === 'completion', describe(focus));
  await s.m.press(KEYS.enter);
  const marked = await s.watchPopup(state => state.status === MANUAL);
  await s.shot('popup-marked');
  check('Enter на кнопке отметки переключает отметку', marked.status === MANUAL && xp(marked.summary) === 20, `${show(marked.status)}, ${show(marked.summary)}`);
}

async function dashboardFirst(s) {
  await s.grant();
  await s.m.navigate(`${s.base}/dashboard.html`);
  const stored = await until(() => s.reading(), value => value?.date === s.today, 40_000);
  current.states.reading = stored;
  check('основной экран без popup сохранил показание за сегодня', stored?.date === s.today && stored.baseline === stored.latest, show(stored));
  if (!stored) return;
  const first = await s.popup(state => !state.solvedHidden);
  const since = `счёт с ${clock.format(new Date(stored.baselineAt))}`;
  check('первое открытие popup: «счёт с» совпадает с показанием основного экрана', first.meta?.startsWith(since), `${show(first.meta)}, ожидалось «${since}»`);
  await s.click('completion');
  const marked = await s.watchPopup(state => state.status === MANUAL);
  check('отметка при 0 / 10: «✓ Тренировка выполнена»', marked.status === MANUAL && marked.solved === '0 /' && marked.target === '10',
    `${show(marked.solved)} ${show(marked.target)}, ${show(marked.status)}`);
  await s.click('completion');
  const undone = await s.watchPopup(state => state.status === OPEN);
  check('отмена при 0 / 10: «○ Сегодня ещё не отмечено», 0 XP', undone.status === OPEN && xp(undone.summary) === 0, `${show(undone.status)}, ${show(undone.summary)}`);
  await s.reading('baseline');
  const counted = await s.popup(state => state.status === COUNTED);
  await s.shot('popup-counted');
  check('после сдвига точки отсчёта на −10 автозачёт срабатывает', counted.status === COUNTED && counted.phrase === REACHED,
    `${show(counted.status)}, ${show(counted.phrase)}`);
}

function parseArgs(argv) {
  const options = { only: null, noNetwork: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-network') options.noNetwork = true;
    else if (arg.startsWith('--only=')) options.only = arg.slice('--only='.length).split(',').map(name => name.trim()).filter(Boolean);
    else throw new Error(`Неизвестный параметр: ${arg}. Справка: --help`);
  }
  if (options.only?.length === 0) throw new Error('Пустой список сценариев в --only.');
  const unknown = (options.only ?? []).filter(name => !SCENARIOS.some(scenario => scenario.name === name));
  if (unknown.length > 0) throw new Error(`Неизвестные сценарии: ${unknown.join(', ')}. Доступны: ${SCENARIOS.map(scenario => scenario.name).join(', ')}.`);
  return options;
}

function checkFirefox() {
  const result = spawnSync('firefox', ['--version'], { env: { ...process.env, MOZ_HEADLESS: '1' }, encoding: 'utf8', timeout: 30_000 });
  if (result.error?.code === 'ENOENT') throw new Error(`Не найден firefox в PATH. Установите Firefox ${MIN_FIREFOX}+.`);
  if (result.error) throw new Error(`Не удалось запустить firefox --version: ${result.error.message}`);
  const text = result.stdout.trim();
  const major = Number.parseInt(/(\d+)\.\d/.exec(text)?.[1], 10);
  if (major < MIN_FIREFOX) throw new Error(`Нужен Firefox ${MIN_FIREFOX}+, найден ${text}.`);
  return text;
}

function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => reject(new Error(`Порт ${port} недоступен (${error.code}). Закройте процесс на нём или задайте другой в FIREFOX_SMOKE_PORT.`)));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

function userPrefs(downloads) {
  const prefs = {
    'marionette.port': PORT, 'browser.shell.checkDefaultBrowser': false,
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.reportingpolicy.firstRun': false,
    'browser.startup.homepage_override.mstone': 'ignore', 'browser.aboutwelcome.enabled': false,
    'app.update.disabledForTesting': true, 'browser.startup.page': 0,
    'browser.download.folderList': 2, 'browser.download.dir': downloads,
    'browser.download.useDownloadDir': true, 'browser.download.always_ask_before_handling_new_types': false,
    'browser.helperApps.neverAsk.saveToDisk': 'application/json', 'browser.download.alwaysOpenPanel': false,
  };
  return Object.entries(prefs).map(([key, value]) => `user_pref(${show(key)}, ${show(value)});\n`).join('');
}

function launchFirefox(profile, logPath) {
  const log = openSync(logPath, 'a');
  const proc = spawn('firefox', ['--marionette', '-remote-allow-system-access', '--no-remote', '--profile', profile], {
    env: { ...process.env, MOZ_HEADLESS: '1' }, stdio: ['ignore', 'ignore', log],
  });
  closeSync(log);
  const launch = { proc, spawnError: null, exited: false };
  launch.done = new Promise(resolve => {
    proc.once('exit', () => { launch.exited = true; resolve(); });
    proc.once('error', error => { launch.spawnError = error; launch.exited = true; resolve(); });
  });
  return launch;
}

async function connect(launch, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (launch.spawnError) {
      throw new Error(launch.spawnError.code === 'ENOENT'
        ? `Не удалось запустить firefox: команда не найдена в PATH. Установите Firefox ${MIN_FIREFOX}+.`
        : `Не удалось запустить firefox: ${launch.spawnError.message}`);
    }
    if (launch.exited) throw new Error('Firefox завершился до запуска Marionette (см. firefox.log во временном каталоге).');
    try { return await Marionette.open(PORT); }
    catch (error) {
      if (Date.now() >= deadline) throw new Error(`Marionette не отвечает на порту ${PORT}: ${error.message}`);
      await sleep(300);
    }
  }
}

async function stopFirefox(m, launch) {
  if (m) {
    try { await m.command('Marionette:Quit', { flags: ['eForceQuit'] }, 10_000); } catch { /* the connection closes as Firefox quits */ }
    m.close();
  } else launch.proc.kill('SIGKILL');
  const gone = await Promise.race([launch.done.then(() => true), sleep(15_000, false, { ref: false })]);
  if (!gone) {
    launch.proc.kill('SIGKILL');
    await launch.done;
  }
}

function removeProfile(profile) {
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { console.error(`Не удалось удалить профиль ${profile}: ${error.message}`); }
}

async function runScenario(scenario, { dir, zip }) {
  const { name } = scenario;
  current = { name, seconds: 0, error: null, checks: [], states: {}, screenshots: [] };
  report.scenarios.push(current);
  console.log(`\n== ${name}: ${scenario.title} ==`);
  const started = Date.now();
  const profile = join(dir, `profile-${name}`);
  const downloads = join(dir, 'downloads', name);
  const screenshots = join(dir, 'screenshots');
  await Promise.all([mkdir(profile), mkdir(downloads, { recursive: true }), mkdir(screenshots, { recursive: true })]);
  await writeFile(join(profile, 'user.js'), userPrefs(downloads));
  const launch = launchFirefox(profile, join(dir, 'firefox.log'));
  active = { launch, profile };
  let m = null;
  try {
    m = await connect(launch);
    const { capabilities } = await m.command('WebDriver:NewSession', { capabilities: {} });
    report.browser = `${capabilities.browserName} ${capabilities.browserVersion}`;
    const { value: addonId } = await m.command('Addon:Install', { path: zip, temporary: true });
    const host = await m.chrome(hostOf, addonId);
    await scenario.run(new Session(m, { name, addonId, base: `moz-extension://${host}/ui`, downloads, screenshots }));
  } catch (error) {
    current.error = error.stack;
    check('сценарий выполнен без исключений', false, error.message);
  } finally {
    await stopFirefox(m, launch);
    removeProfile(profile);
    active = null;
    current.seconds = Math.round((Date.now() - started) / 100) / 10;
  }
}

const duration = ms => `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error(`Некорректный FIREFOX_SMOKE_PORT: ${process.env.FIREFOX_SMOKE_PORT}.`);
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const zip = join(ROOT, 'dist', `lichess-training-${version}.zip`);
  try { await access(zip); } catch {
    throw new Error(`Не найден пакет ${relative(ROOT, zip)}. Соберите его: npm run build:addon (npm run smoke:firefox делает это сам).`);
  }
  const chosen = SCENARIOS.filter(scenario => !options.only || options.only.includes(scenario.name));
  const selected = chosen.filter(scenario => !(options.noNetwork && scenario.network));
  const skipped = chosen.filter(scenario => !selected.includes(scenario));
  if (selected.length === 0) throw new Error('Нет сценариев для запуска: --no-network исключил все выбранные.');
  const firefox = checkFirefox();
  await ensurePortFree(PORT);
  const dir = await mkdtemp(join(tmpdir(), 'lichess-training-smoke-'));
  const started = Date.now();
  console.log(`${firefox} · пакет: ${relative(ROOT, zip)} · порт Marionette: ${PORT}\nВременный каталог: ${dir}`);
  if (skipped.length > 0) console.log(`Пропущено без сети: ${skipped.map(scenario => scenario.name).join(', ')}`);
  try {
    for (const scenario of selected) await runScenario(scenario, { dir, zip });
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  const failures = report.scenarios.flatMap(scenario => scenario.checks.filter(item => !item.ok).map(item => `  ✗ [${scenario.name}] ${item.name}`));
  if (failures.length > 0) console.log(`\nПровалы:\n${failures.join('\n')}`);
  console.log(`\n${report.total} проверок, ${report.failed} провалов`);
  console.log(`Время: ${duration(Date.now() - started)}`);
  console.log(`Отчёт, скриншоты и загрузки: ${dir}`);
  if (report.failed > 0) process.exitCode = 1;
}

// However the run ends, a started Firefox and its profile must not outlive it.
process.on('exit', () => {
  if (!active) return;
  active.launch.proc.kill('SIGKILL');
  removeProfile(active.profile);
});
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
