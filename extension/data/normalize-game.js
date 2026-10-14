const SPEEDS = new Set(['bullet', 'blitz', 'rapid']);
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd', 'unknownFinish']);
const ANALYSIS_FIELDS = ['acpl', 'inaccuracy', 'mistake', 'blunder'];
// The last instant whose calendar date in the +06:00 zone still has a four-digit year; later instants produce five-digit date keys.
const MAX_TIMESTAMP = Date.parse('9999-12-31T23:59:59.999+06:00');

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Некорректное поле ${field}.`);
  return value;
}

function string(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Некорректное поле ${field}.`);
  return value;
}

function optionalInteger(value, field, minimum = -Infinity) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Некорректное поле ${field}.`);
  return value;
}

function player(value, color) {
  object(value, `players.${color}`);
  const user = object(value.user, `players.${color}.user`);
  const id = string(user.id ?? user.name, `players.${color}.user.id`).toLowerCase();
  const name = string(user.name ?? user.id, `players.${color}.user.name`);
  const rating = optionalInteger(value.rating, `players.${color}.rating`, 1);
  const ratingDiff = optionalInteger(value.ratingDiff, `players.${color}.ratingDiff`);
  let analysis = null;
  if (value.analysis != null) {
    object(value.analysis, `players.${color}.analysis`);
    analysis = Object.fromEntries(ANALYSIS_FIELDS.map(field => [field, optionalInteger(value.analysis[field], `analysis.${field}`, 0)]));
  }
  return { id, name, rating, ratingDiff, analysis };
}

// Lichess ids are lowercase; the login is compared the same way so its case never matters.
export function requireUsername(username) {
  if (typeof username !== 'string' || !username.trim()) throw new Error('Не указан логин Lichess.');
  return username.toLowerCase();
}

export function normalizeGameCandidate(raw, username) {
  object(raw, 'game');
  const profile = requireUsername(username);
  if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(raw.id)) throw new Error('Некорректный ID партии.');
  if (typeof raw.rated !== 'boolean') throw new Error('Некорректное поле rated.');
  string(raw.variant, 'variant');
  string(raw.speed, 'speed');
  string(raw.status, 'status');
  for (const field of ['createdAt', 'lastMoveAt']) {
    if (!Number.isSafeInteger(raw[field]) || raw[field] < 0 || raw[field] > MAX_TIMESTAMP) throw new Error(`Некорректное время ${field}.`);
  }
  if (raw.lastMoveAt < raw.createdAt) throw new Error('Последний ход предшествует началу партии.');
  if (Object.hasOwn(raw, 'winner') && raw.winner !== 'white' && raw.winner !== 'black') throw new Error('Некорректный winner партии.');
  object(raw.players, 'players');
  const white = player(raw.players.white, 'white');
  const black = player(raw.players.black, 'black');
  if ((white.id === profile) === (black.id === profile)) throw new Error('Партия принадлежит другому профилю или содержит неоднозначный профиль.');
  const color = white.id === profile ? 'white' : 'black';
  const own = color === 'white' ? white : black;
  const opponent = color === 'white' ? black : white;
  if (raw.moves !== undefined && typeof raw.moves !== 'string') throw new Error('Некорректное поле moves.');
  let opening = null;
  if (raw.opening != null) {
    object(raw.opening, 'opening');
    opening = { eco: string(raw.opening.eco, 'opening.eco'), name: string(raw.opening.name, 'opening.name') };
  }
  if (raw.analysis != null && !Array.isArray(raw.analysis)) throw new Error('Некорректное поле analysis.');
  const hasAggregate = p => p.analysis !== null && Object.values(p.analysis).some(value => value !== null);
  const record = {
    id: raw.id, username: profile, speed: raw.speed, createdAt: raw.createdAt, lastMoveAt: raw.lastMoveAt,
    status: raw.status, rated: raw.rated, variant: raw.variant, color,
    result: raw.winner === undefined ? 'draw' : raw.winner === color ? 'win' : 'loss',
    rating: own.rating, ratingDiff: own.ratingDiff,
    opponent: { id: opponent.id, name: opponent.name, rating: opponent.rating },
    opening, moves: raw.moves ?? '',
    analysed: (raw.analysis?.length ?? 0) > 0 || hasAggregate(white) || hasAggregate(black),
    playerAnalysis: own.analysis,
  };
  return { record, included: raw.rated && raw.variant === 'standard' && SPEEDS.has(raw.speed) && FINISHED.has(raw.status) };
}

export function normalizeGame(raw, username) {
  const candidate = normalizeGameCandidate(raw, username);
  return candidate.included ? candidate.record : null;
}
