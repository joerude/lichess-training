import { getSyncState, parseLivePage, advanceSyncState, buildSyncSnapshot } from '../core/sync-state.js';

const PAGE_SIZE = 200;

export function createSyncService({ repository, lichess, canAccess = async () => false, now = () => new Date() }) {
  let active = null;

  function readClock() {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Некорректное время обновления.');
    return new Date(value.getTime());
  }

  async function snapshot(instant) {
    const history = await repository.readSyncHistory();
    return buildSyncSnapshot(history, instant, await canAccess());
  }

  async function nextBatch() {
    const instant = readClock();
    const history = await repository.readSyncHistory();
    const state = getSyncState(history, instant);
    if (!await canAccess()) throw new Error('Разрешите доступ к Lichess кнопкой «Обновить партии».');
    if (state.retryAfter !== null && instant.getTime() < state.retryAfter) {
      throw new Error('Lichess просит паузу. Повторите обновление после указанного времени.');
    }
    const since = state.nextSince ?? state.coverageStart;
    const until = state.cycleUntil ?? instant.getTime();
    if (since >= until) throw new Error('Время обновления ещё не достигло начала выбранного периода.');
    let page;
    try {
      page = await lichess.fetchGamesPage({ since, until, max: PAGE_SIZE });
    } catch (error) {
      if (Number.isSafeInteger(error?.retryAt) && error.retryAt > instant.getTime()) {
        const paused = { ...state, revision: state.revision + 1, retryAfter: error.retryAt };
        getSyncState({ ...history, sync: paused }, instant);
        await repository.saveSyncBatch({ games: [], sync: paused, expectedRevision: state.revision });
      }
      throw error;
    }
    const parsed = parseLivePage(page, { since, until, max: PAGE_SIZE });
    const next = advanceSyncState(state, { since, until, rows: page.rows,
      lastCreatedAt: parsed.lastCreatedAt, max: PAGE_SIZE }, instant);
    const saved = await repository.saveSyncBatch({ games: parsed.games, sync: next, expectedRevision: state.revision });
    const result = await snapshot(instant);
    return { snapshot: result, report: { rows: page.rows, eligible: parsed.games.length, skipped: parsed.skipped,
      ...saved, total: result.overview.totalGames, hasMore: page.rows === PAGE_SIZE } };
  }

  return {
    async handle(command) {
      if (command?.type === 'sync.getSnapshot') return snapshot(readClock());
      if (command?.type !== 'sync.nextBatch') throw new Error('Неизвестная команда обновления.');
      if (active) return active;
      active = nextBatch().finally(() => { active = null; });
      return active;
    },
  };
}
