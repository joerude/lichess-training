import { normalizeBackup, trainingDay } from './training-engine.js';
import {
  TASK_IDS, requireObject, requireDate, shiftDate, requireRevision,
  normalizeTargets, normalizeNote, requireGameId, normalizeTimestamp,
} from './practice-validation.js';

const FORMAT = 'lichess-training-backup';
const MAX_BYTES = 16 * 1024 * 1024;

function checkSize(value) {
  let json;
  try { json = JSON.stringify(value); } catch { throw new Error('Некорректная резервная копия.'); }
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_BYTES) {
    throw new Error('Резервная копия превышает 16 МиБ или имеет неверный формат.');
  }
}

function requireList(value, maximum, name, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`Некорректный список ${name}: максимум ${maximum.toLocaleString('ru-RU').replace(/\s/g, ' ')}.`);
  }
  return value;
}

function normalizePractice(input, today) {
  const practice = requireObject(input);
  if (practice.version !== 1) throw new Error('Неподдерживаемая версия программы.');
  const startedOn = requireDate(practice.startedOn);
  if (startedOn > today) throw new Error('Дата начала программы находится в будущем.');
  const revision = requireRevision(practice.revision);
  const tomorrow = shiftDate(today, 1);
  let previousDate = null;
  const rules = Array.from(requireList(practice.rules, 10000, 'правил', 1), entry => {
    requireObject(entry);
    const effectiveFrom = requireDate(entry.effectiveFrom);
    if ((previousDate === null && effectiveFrom !== startedOn) ||
        (previousDate !== null && effectiveFrom <= previousDate) || effectiveFrom > tomorrow) {
      throw new Error('Некорректная дата или порядок правил программы.');
    }
    previousDate = effectiveFrom;
    return { effectiveFrom, targets: normalizeTargets(entry.targets) };
  });
  const inRange = date => {
    requireDate(date);
    if (date < startedOn || date > today) throw new Error('Дата записи вне периода программы.');
    return date;
  };
  const ids = new Set();
  const reviews = Array.from(requireList(practice.reviews, 1000, 'заметок'), entry => {
    requireObject(entry);
    const gameId = requireGameId(entry.gameId);
    if (ids.has(gameId)) throw new Error('Повторяющийся ID партии в заметках.');
    ids.add(gameId);
    const date = inRange(entry.date);
    const createdAt = normalizeTimestamp(entry.createdAt);
    const updatedAt = normalizeTimestamp(entry.updatedAt);
    if (trainingDay(new Date(createdAt)) !== date || updatedAt < createdAt || trainingDay(new Date(updatedAt)) > today) {
      throw new Error('Время заметки не соответствует дню или порядку правок.');
    }
    return { gameId, date, note: normalizeNote(entry.note), createdAt, updatedAt, revision: requireRevision(entry.revision) };
  });
  const nextReviewRevision = requireRevision(practice.nextReviewRevision);
  if (reviews.some(review => review.revision >= nextReviewRevision)) throw new Error('Некорректная следующая версия заметки.');
  const rewardIds = new Set();
  const rewards = Array.from(requireList(practice.rewards, 50000, 'наград'), entry => {
    requireObject(entry);
    const date = inRange(entry.date);
    if (!TASK_IDS.includes(entry.taskId) || entry.id !== `${startedOn}:${date}:${entry.taskId}` || rewardIds.has(entry.id)) {
      throw new Error('Некорректный или повторяющийся ID награды.');
    }
    rewardIds.add(entry.id);
    if (entry.points !== 20) throw new Error('Награда должна содержать 20 XP.');
    const earnedAt = normalizeTimestamp(entry.earnedAt);
    const earnedDay = trainingDay(new Date(earnedAt));
    if (earnedDay < date || earnedDay > today) throw new Error('Время получения награды вне допустимого периода.');
    return { id: entry.id, date, taskId: entry.taskId, points: 20, earnedAt };
  });
  return { version: 1, startedOn, revision, nextReviewRevision, rules, reviews, rewards };
}

export function normalizePracticeBackup(backup, today) {
  requireDate(today);
  requireObject(backup);
  if (backup.format !== FORMAT || ![1, 2].includes(backup.version)) {
    throw new Error('Неподдерживаемый формат или версия резервной копии.');
  }
  if (backup.version === 1) {
    const journal = normalizeBackup(backup, today);
    return { version: 1, exportedAt: normalizeTimestamp(backup.exportedAt), journal, practice: null };
  }
  checkSize(backup);
  const exportedAt = normalizeTimestamp(backup.exportedAt);
  const journal = normalizeBackup({ format: FORMAT, version: 1, exportedAt, state: backup.state }, today);
  const practice = normalizePractice(backup.practice, today);
  return { version: 2, exportedAt, journal, practice };
}

export function practiceBackupFrom({ journal, practice }, instant) {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new Error('Некорректное время экспорта.');
  const exportedAt = normalizeTimestamp(instant.toISOString());
  const backup = { format: FORMAT, version: 2, exportedAt, state: structuredClone(journal), practice: structuredClone(practice) };
  checkSize(backup);
  return backup;
}

export function practiceBackupPreview(normalized) {
  const { version, exportedAt, journal, practice } = normalized;
  return { version, exportedAt, profile: { ...journal.profile }, startedOn: practice?.startedOn ?? null,
    days: journal.days.length, completedDays: journal.days.filter(day => day.completedAt !== null).length,
    puzzleTarget: journal.program.target, programStartedOn: journal.program.startedOn,
    ruleCount: practice?.rules.length ?? 0, reviewCount: practice?.reviews.length ?? 0,
    totalXp: practice?.rewards.reduce((sum, reward) => sum + reward.points, 0) ?? 0,
    replacesPractice: version === 2 };
}
