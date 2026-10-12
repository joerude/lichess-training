import { setCompletion } from './training-engine.js';

export const PUZZLE_REFRESH_MS = 60000;

function usable(record) {
  return Boolean(record) && typeof record === 'object' && typeof record.date === 'string' &&
    Number.isSafeInteger(record.baseline) && Number.isSafeInteger(record.latest) &&
    record.baseline >= 0 && record.latest >= record.baseline &&
    typeof record.baselineAt === 'string' && Number.isFinite(Date.parse(record.baselineAt)) &&
    typeof record.observedAt === 'string' && Number.isFinite(Date.parse(record.observedAt));
}

// A reading for today that is younger than a minute is reused instead of asking Lichess again.
export function shouldFetchPuzzles(record, instant, today) {
  if (!usable(record) || record.date !== today) return true;
  const elapsed = instant.getTime() - Date.parse(record.observedAt);
  return elapsed < 0 || elapsed >= PUZZLE_REFRESH_MS;
}

// The first reading of a Bishkek day becomes its baseline; a lower counter restarts the count.
export function observePuzzleCount(record, count, instant, today) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Некорректный счётчик задач Lichess.');
  const at = instant.toISOString();
  if (!usable(record) || record.date !== today || count < record.baseline) {
    return { date: today, baseline: count, latest: count, baselineAt: at, observedAt: at };
  }
  return { ...record, latest: count, observedAt: at };
}

export function solvedToday(record, today) {
  return usable(record) && record.date === today ? record.latest - record.baseline : null;
}

// Returns the same journal object when nothing changes, so callers can detect a new mark.
export function applyAutoCompletion(journal, today, solved, instant) {
  if (!Number.isSafeInteger(solved)) return journal;
  const day = journal.days.find(entry => entry.date === today);
  if (day?.completedAt != null || day?.autoSuppressed === true) return journal;
  if (solved < (day?.target ?? journal.program.target)) return journal;
  const completed = setCompletion(journal, today, true, instant);
  return { ...completed, days: completed.days.map(entry => entry.date === today ? { ...entry, source: 'auto' } : entry) };
}
