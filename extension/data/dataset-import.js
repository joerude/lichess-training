import { normalizeGameCandidate } from './normalize-game.js';

const MAX_GAME_BYTES = 20 * 1024 * 1024;
const MAX_RATING_BYTES = 1024 * 1024;
const MAX_ROWS = 100000;
const SERIES = ['Bullet', 'Blitz', 'Rapid', 'Puzzles'];

function requireText(text, maximum, label) {
  if (typeof text !== 'string') throw new Error(`${label}: ожидается текст файла.`);
  if (new TextEncoder().encode(text).byteLength > maximum) throw new Error(`${label}: размер превышает ${maximum / 1024 / 1024} МиБ.`);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ratingPoint(row) {
  if (!Array.isArray(row) || row.length !== 4 || !Array.from(row).every(Number.isSafeInteger)) throw new Error('Некорректная точка рейтинга.');
  const [year, month, day, rating] = row;
  if (year < 1 || year > 9999 || month < 0 || month > 11 || day < 1 || day > 31 || rating < 1) throw new Error('Некорректная дата или значение рейтинга.');
  const date = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Некорректная календарная дата рейтинга.');
  return { date, rating };
}

export function normalizeRatingHistory(text) {
  requireText(text, MAX_RATING_BYTES, 'История рейтинга');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('История рейтинга: некорректный JSON.'); }
  if (!Array.isArray(raw)) throw new Error('История рейтинга должна содержать массив серий.');
  const accepted = new Map();
  for (const series of raw) {
    if (!object(series) || typeof series.name !== 'string' || !series.name) throw new Error('Некорректная рейтинговая серия.');
    if (!SERIES.includes(series.name)) continue;
    if (!Array.isArray(series.points)) throw new Error(`Некорректные точки серии ${series.name}.`);
    if (!accepted.has(series.name)) accepted.set(series.name, new Map());
    const points = accepted.get(series.name);
    for (const row of series.points) {
      const point = ratingPoint(row);
      if (points.has(point.date) && points.get(point.date) !== point.rating) throw new Error(`Противоречивый рейтинг ${series.name} на дату ${point.date}.`);
      points.set(point.date, point.rating);
    }
  }
  return SERIES.filter(name => accepted.has(name)).map(name => ({
    name, points: [...accepted.get(name)].sort(([a], [b]) => a.localeCompare(b)).map(([date, rating]) => ({ date, rating })),
  }));
}

export function parseDataset(gamesText, ratingsText = null, username = 'sebajun777') {
  requireText(gamesText, MAX_GAME_BYTES, 'История партий');
  const unique = new Map();
  const seen = new Map();
  let rows = 0;
  let duplicates = 0;
  let skipped = 0;
  let firstGameAt = null;
  let lastGameAt = null;
  const lines = gamesText.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    rows += 1;
    if (rows > MAX_ROWS) throw new Error(`Строка ${index + 1}: история партий превышает максимум ${MAX_ROWS} непустых строк.`);
    try {
      const { record: game, included } = normalizeGameCandidate(JSON.parse(lines[index]), username);
      const serialized = JSON.stringify(game);
      const previous = seen.get(game.id);
      if (previous !== undefined && previous !== serialized) throw new Error(`Противоречивый повтор партии ${game.id}.`);
      seen.set(game.id, serialized);
      if (!included) { skipped += 1; continue; }
      if (previous) {
        duplicates += 1;
        continue;
      }
      unique.set(game.id, game);
      firstGameAt = firstGameAt === null ? game.createdAt : Math.min(firstGameAt, game.createdAt);
      lastGameAt = lastGameAt === null ? game.createdAt : Math.max(lastGameAt, game.createdAt);
    } catch (error) {
      throw new Error(`Строка ${index + 1}: ${error.message}`);
    }
  }
  if (!unique.size) throw new Error('Файл не содержит подходящих завершённых партий профиля.');
  const ratings = ratingsText === null ? null : normalizeRatingHistory(ratingsText);
  return {
    games: [...unique.values()], ratings,
    report: { rows, unique: unique.size, duplicates, skipped, ratingPoints: ratings?.reduce((sum, series) => sum + series.points.length, 0) ?? 0, firstGameAt, lastGameAt },
  };
}
