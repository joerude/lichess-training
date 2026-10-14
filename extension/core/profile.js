import { requireDate } from './practice-validation.js';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,28}[a-z0-9]$/;
const HOUR = 3600000;

// Background-side state: the profile that every command works for.
let active = null;
// Grows with every change of the profile, so a command can tell that the profile changed while it waited.
let generation = 0;

// Returns the canonical spelling ('asia/bishkek' becomes 'Asia/Bishkek'), so what is stored and compared later agrees.
function requireTimeZone(timeZone) {
  if (typeof timeZone === 'string' && timeZone !== '') {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    } catch { /* unknown identifier, reported below */ }
  }
  throw new Error('Неизвестный часовой пояс.');
}

export function normalizeProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректный профиль.');
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  if (!USERNAME_PATTERN.test(username)) throw new Error('Логин Lichess: 2–30 символов, латинские буквы, цифры, «_» и «-».');
  return { username, timeZone: requireTimeZone(input.timeZone) };
}

export function setActiveProfile(profile) {
  active = normalizeProfile(profile);
  generation += 1;
  return { ...active };
}

export function clearActiveProfile() {
  active = null;
  generation += 1;
}

export function profileGeneration() {
  return generation;
}

// Throws when the profile is no longer the one `expected` (a profileGeneration() taken earlier) was read for.
export function requireSameProfile(expected) {
  if (generation !== expected) throw new Error('Профиль изменился во время загрузки. Повторите действие.');
}

export function hasActiveProfile() {
  return active !== null;
}

export function activeProfile() {
  if (active === null) {
    const error = new Error('Сначала укажите свой логин Lichess.');
    error.code = 'profile-required';
    throw error;
  }
  return { ...active };
}

// The first instant (ms since the epoch) at which `day` (YYYY-MM-DD) has begun in `timeZone`.
// Found by bisection on the local calendar date, so offsets, daylight saving changes and a skipped
// local midnight need no special cases. It assumes the local date never steps backwards.
export function dayStart(day, timeZone) {
  requireDate(day);
  requireTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, era: 'short', year: 'numeric', month: 'numeric', day: 'numeric' });
  const localDate = instant => {
    const fields = {};
    for (const { type, value } of formatter.formatToParts(instant)) fields[type] = value;
    const year = fields.era === 'BC' ? 1 - Number(fields.year) : Number(fields.year);
    return year * 10000 + Number(fields.month) * 100 + Number(fields.day);
  };
  const [year, month, date] = day.split('-').map(Number);
  const target = year * 10000 + month * 100 + date;
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  // Every UTC offset is within 16 hours, so 36 hours around UTC midnight always brackets the start.
  let before = utcMidnight - 36 * HOUR;
  let after = utcMidnight + 36 * HOUR;
  if (localDate(before) >= target || localDate(after) < target) throw new Error('Не удалось определить начало дня.');
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2);
    if (localDate(middle) >= target) after = middle;
    else before = middle;
  }
  return after;
}
