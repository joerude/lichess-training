import { normalizeGame } from '../data/normalize-game.js';
import { trainingDay } from './training-engine.js';
import { buildHistoryOverview } from './history-statistics.js';

const SPEEDS = ['bullet', 'blitz', 'rapid'];
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd', 'unknownFinish']);
const MAX_TIME = Date.parse('9999-12-31T23:59:59.999+06:00');
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;

export function getSyncState(history, instant) {
  if (!validTime(instant.getTime())) throw new Error('Некорректное время обновления.');
  if (history.sync) {
    const state = history.sync;
    if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !validTime(state.coverageStart) ||
        ['cycleUntil', 'nextSince', 'completedUntil', 'retryAfter'].some(key => state[key] !== null && !validTime(state[key])) ||
        (state.cycleUntil === null) !== (state.nextSince === null) ||
        (state.nextSince !== null && (state.nextSince < state.coverageStart || state.nextSince >= state.cycleUntil)) ||
        (state.lastSuccessAt !== null && (typeof state.lastSuccessAt !== 'string' || !Number.isFinite(Date.parse(state.lastSuccessAt))))) {
      throw new Error('Состояние обновления повреждено.');
    }
    return structuredClone(state);
  }
  let latest = null;
  for (const game of history.games) latest = latest === null ? game.createdAt : Math.max(latest, game.createdAt);
  const floor = latest === null ? instant.getTime() - 30 * 86400000 : Math.min(latest, instant.getTime()) - 7 * 86400000;
  return { revision: 0, coverageStart: Math.max(0, floor), cycleUntil: null, nextSince: null,
    completedUntil: null, lastSuccessAt: null, retryAfter: null };
}

export function parseLivePage(page, { since, until, max = 200 }) {
  if (!page || !Array.isArray(page.records) || page.rows !== page.records.length || page.rows > max ||
      !validTime(since) || !validTime(until) || since >= until) throw new Error('Некорректная порция Lichess.');
  const games = new Map();
  let skipped = 0;
  let lastCreatedAt = null;
  for (const [index, raw] of Array.from(page.records).entries()) {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[a-zA-Z0-9]{8}$/.test(raw.id) ||
          !validTime(raw.createdAt) || raw.createdAt < since || raw.createdAt >= until ||
          (lastCreatedAt !== null && raw.createdAt < lastCreatedAt) || typeof raw.rated !== 'boolean' ||
          ['variant', 'speed', 'status'].some(key => typeof raw[key] !== 'string' || !raw[key])) {
        throw new Error('Неверная запись, порядок или время партии.');
      }
      lastCreatedAt = raw.createdAt;
      if (!raw.rated || raw.variant !== 'standard' || !SPEEDS.includes(raw.speed) || !FINISHED.has(raw.status)) {
        skipped += 1;
        continue;
      }
      const game = normalizeGame(raw);
      const previous = games.get(game.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(game)) throw new Error('Противоречивый повтор game ID.');
      games.set(game.id, game);
    } catch (error) { throw new Error(`Запись ${index + 1}: ${error.message}`); }
  }
  return { games: [...games.values()], skipped, lastCreatedAt };
}

export function advanceSyncState(state, { since, until, rows, lastCreatedAt, max = 200 }, instant) {
  if (rows === max && (lastCreatedAt === null || lastCreatedAt <= since)) {
    throw new Error('Не удалось продвинуть дату: заполненная порция содержит одинаковые времена. История не объявлена полной.');
  }
  return { ...state, revision: state.revision + 1, retryAfter: null,
    cycleUntil: rows === max ? until : null,
    nextSince: rows === max ? lastCreatedAt : null,
    completedUntil: rows === max ? state.completedUntil : until,
    lastSuccessAt: rows === max ? state.lastSuccessAt : instant.toISOString() };
}

export function buildSyncSnapshot(history, instant, permissionGranted) {
  const date = trainingDay(instant);
  const groups = SPEEDS.map(speed => ({ speed, games: 0 }));
  for (const game of history.games) {
    if (trainingDay(new Date(game.createdAt)) === date) groups.find(group => group.speed === game.speed).games += 1;
  }
  return { overview: buildHistoryOverview(history), sync: getSyncState(history, instant), today: { date, groups }, permissionGranted };
}
