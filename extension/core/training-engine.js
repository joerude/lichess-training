const USERNAME = 'sebajun777';
const TIME_ZONE = 'Asia/Bishkek';
const PROGRAM_ID = 'daily-puzzles';
const PROGRAM_TITLE = 'Ежедневная тактика';
const BACKUP_FORMAT = 'lichess-training-backup';
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

export function dayKey(date, timeZone) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Некорректное время.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const field = type => parts.find(part => part.type === type).value;
  return `${field('year').padStart(4, '0')}-${field('month')}-${field('day')}`;
}

export function trainingDay(date) {
  return dayKey(date, TIME_ZONE);
}

export function initialState(today) {
  return {
    profile: { username: USERNAME, timeZone: TIME_ZONE },
    program: { id: PROGRAM_ID, title: PROGRAM_TITLE, target: 10, startedOn: today },
    days: [],
  };
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректная резервная копия.');
  return value;
}

function requireTarget(value) {
  if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error('Цель должна быть целым числом от 1 до 500.');
  return value;
}

function normalizedTimestamp(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !isCalendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    throw new Error('Некорректная дата и время в резервной копии.');
  }
  if (match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4, 6)) > 59)) {
    throw new Error('Некорректный часовой пояс даты.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Некорректная дата и время в резервной копии.');
  return parsed.toISOString();
}

// Optional 0.4.1 fields: who completed the day and whether a manual undo blocks automatic counting.
function dayFlags(entry, completedAt) {
  const flags = {};
  if (entry.source !== undefined) {
    if (completedAt === null || !['manual', 'auto'].includes(entry.source)) throw new Error('Некорректный источник отметки дня.');
    flags.source = entry.source;
  }
  if (entry.autoSuppressed !== undefined) {
    if (entry.autoSuppressed !== true) throw new Error('Некорректный запрет автоподсчёта дня.');
    flags.autoSuppressed = true;
  }
  return flags;
}

export function normalizeBackup(backup, today) {
  let json;
  try { json = JSON.stringify(backup); } catch { throw new Error('Некорректная резервная копия.'); }
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('Резервная копия превышает 2 МиБ или имеет неверный формат.');
  }
  requireObject(backup);
  if (backup.format !== BACKUP_FORMAT || backup.version !== 1) throw new Error('Неподдерживаемый формат или версия резервной копии.');
  normalizedTimestamp(backup.exportedAt);
  const state = requireObject(backup.state);
  const profile = requireObject(state.profile);
  const program = requireObject(state.program);
  if (profile.username !== USERNAME || profile.timeZone !== TIME_ZONE || program.id !== PROGRAM_ID) {
    throw new Error('Резервная копия принадлежит другому профилю, часовому поясу или программе.');
  }
  if (!isCalendarDate(program.startedOn) || program.startedOn > today) throw new Error('Некорректная дата начала программы.');
  if (!Array.isArray(state.days) || state.days.length > 10000) throw new Error('Некорректный список дней (максимум 10 000).');
  const dates = new Set();
  // Array.from visits sparse slots too, so structured-clone messages cannot skip validation.
  const days = Array.from(state.days, entry => {
    requireObject(entry);
    if (!isCalendarDate(entry.date) || entry.date < program.startedOn || entry.date > today || dates.has(entry.date)) {
      throw new Error('Некорректная или повторяющаяся дата дня в резервной копии.');
    }
    dates.add(entry.date);
    const completedAt = entry.completedAt === null ? null : normalizedTimestamp(entry.completedAt);
    if (completedAt !== null && trainingDay(new Date(completedAt)) !== entry.date) {
      throw new Error('Время завершения не соответствует тренировочному дню.');
    }
    return { date: entry.date, target: requireTarget(entry.target), completedAt, ...dayFlags(entry, completedAt) };
  });
  return {
    profile: { username: USERNAME, timeZone: TIME_ZONE },
    program: { id: PROGRAM_ID, title: PROGRAM_TITLE, target: requireTarget(program.target), startedOn: program.startedOn },
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function setCompletion(state, today, completed, instant) {
  if (today < state.program.startedOn) throw new Error('Тренировочный день предшествует началу программы.');
  const existing = state.days.find(entry => entry.date === today);
  const day = {
    date: today,
    target: existing?.target ?? state.program.target,
    completedAt: completed ? existing?.completedAt ?? instant.toISOString() : null,
  };
  // Keep who completed the day; an undo stops automatic counting from marking it again today.
  if (completed && existing?.completedAt != null && existing.source) day.source = existing.source;
  if (!completed) day.autoSuppressed = true;
  return {
    ...state,
    days: [...state.days.filter(entry => entry.date !== today), day].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function snapshotFrom(state, today) {
  const current = state.days.find(entry => entry.date === today);
  const completed = new Set(state.days.filter(entry => entry.completedAt !== null).map(entry => entry.date));
  const midnight = new Date(`${today}T00:00:00.000Z`);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(midnight.getTime() - (6 - index) * 86400000).toISOString().slice(0, 10);
    return { date, scheduled: date >= state.program.startedOn, completed: completed.has(date) };
  });
  return {
    profile: { ...state.profile },
    program: { ...state.program },
    today: {
      date: today, taskId: 'puzzles', target: current?.target ?? state.program.target,
      completed: current?.completedAt != null, completedAt: current?.completedAt ?? null,
      source: current?.completedAt != null ? current.source ?? 'manual' : null,
    },
    week,
    completedDays: completed.size,
  };
}

export function backupFrom(state, instant) {
  return { format: BACKUP_FORMAT, version: 1, exportedAt: instant.toISOString(), state };
}
