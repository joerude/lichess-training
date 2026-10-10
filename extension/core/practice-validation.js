export const TASK_IDS = ['bullet', 'blitz', 'rapid', 'puzzles', 'reviews'];
export const DEFAULT_TARGETS = { bullet: 5, blitz: 5, rapid: 0, puzzles: 10, reviews: 1 };

export function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректная запись программы.');
  return value;
}

export function requireDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new Error('Некорректный тренировочный день.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Некорректный тренировочный день.');
  }
  return value;
}

export function shiftDate(date, days) {
  requireDate(date);
  return requireDate(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10));
}

export function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Некорректная версия записи.');
  return value;
}

export function nextRevision(value) {
  return requireRevision(requireRevision(value) + 1);
}

export function normalizeTargets(input) {
  requireObject(input);
  const targets = {};
  for (const key of TASK_IDS) {
    const minimum = key === 'puzzles' ? 1 : 0;
    const maximum = key === 'puzzles' ? 500 : key === 'reviews' ? 10 : 100;
    if (!Number.isInteger(input[key]) || input[key] < minimum || input[key] > maximum) {
      throw new Error(`Норма ${key} должна быть целым числом от ${minimum} до ${maximum}.`);
    }
    targets[key] = input[key];
  }
  return targets;
}

export function normalizeNote(note) {
  if (typeof note !== 'string' || !note.trim()) throw new Error('Введите непустую заметку разбора.');
  const trimmed = note.trim();
  if (new TextEncoder().encode(trimmed).byteLength > 4000) throw new Error('Заметка разбора превышает 4 000 байт UTF-8.');
  return trimmed;
}

export function requireGameId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(value)) throw new Error('Некорректный ID партии.');
  return value;
}

export function normalizeTimestamp(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error('Некорректная дата и время.');
  requireDate(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 ||
      (match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4, 6)) > 59))) {
    throw new Error('Некорректная дата и время.');
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error('Некорректная дата и время.');
  const result = instant.toISOString();
  requireDate(result.slice(0, 10));
  return result;
}
