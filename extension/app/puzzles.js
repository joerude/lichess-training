import { trainingDay, snapshotFrom } from '../core/training-engine.js';
import { shouldFetchPuzzles, solvedToday } from '../core/puzzle-progress.js';

function failureStatus(error) {
  if (Number.isSafeInteger(error?.retryAt)) return 'rate-limited';
  return error?.code === 'no-data' ? 'no-data' : 'offline';
}

export function createPuzzleService({ repository, practice, lichess, canAccess = async () => false, now = () => new Date() }) {
  let active = null;

  function readClock() {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Некорректное время обновления.');
    return new Date(value.getTime());
  }

  async function refresh() {
    const checkedAt = readClock();
    const stored = await repository.readPuzzleReading();
    let status = 'ok';
    let count = null;
    if (!await canAccess()) status = 'no-permission';
    else if (shouldFetchPuzzles(stored, checkedAt, trainingDay(checkedAt))) {
      try { count = await lichess.fetchPuzzleCount(); }
      catch (error) { status = failureStatus(error); }
    }
    // Record with the time after the request, so a reading taken after midnight starts the new day.
    const instant = readClock();
    const today = trainingDay(instant);
    const { records, autoCompleted } = await practice.recordPuzzleCount(instant, count);
    const day = snapshotFrom(records.journal, today).today;
    const solved = solvedToday(records.puzzles, today);
    return { status, date: today, solved, target: day.target, completed: day.completed, source: day.source,
      baselineAt: solved === null ? null : records.puzzles.baselineAt,
      observedAt: solved === null ? null : records.puzzles.observedAt, autoCompleted };
  }

  return {
    async handle(command) {
      if (command?.type !== 'puzzles.refresh') throw new Error('Неизвестная команда счётчика задач.');
      if (active) return active;
      active = refresh().finally(() => { active = null; });
      return active;
    },
  };
}
