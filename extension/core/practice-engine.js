import { initialState, trainingDay } from './training-engine.js';
import { activeProfile, dayStart } from './profile.js';
import {
  TASK_IDS, DEFAULT_TARGETS, requireDate, shiftDate, requireRevision, nextRevision,
  normalizeTargets, normalizeNote, requireGameId, normalizeTimestamp,
} from './practice-validation.js';

export { normalizeTargets };

const GAME_TASKS = new Set(['bullet', 'blitz', 'rapid']);
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd', 'unknownFinish']);

function requireInstant(instant, today) {
  requireDate(today);
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new Error('Некорректное время.');
  const timestamp = normalizeTimestamp(instant.toISOString());
  if (trainingDay(instant) !== today) throw new Error('Время не соответствует тренировочному дню.');
  return timestamp;
}

function checkDay(practice, today) {
  requireDate(today);
  if (today < practice.startedOn) throw new Error('Тренировочный день предшествует началу программы.');
}

function checkRevision(actual, expected) {
  requireRevision(actual);
  if (!Number.isSafeInteger(expected) || expected < 0 || actual !== expected) {
    throw new Error('Версия записи изменилась. Обновите программу и повторите действие.');
  }
}

export function initialPractice(journal, today) {
  requireDate(today);
  const state = journal ?? initialState(today);
  const legacyTarget = state.program.target;
  const target = state.days.find(day => day.date === today)?.target ?? legacyTarget;
  const targets = normalizeTargets({ ...DEFAULT_TARGETS, puzzles: target });
  const rules = [{ effectiveFrom: today, targets }];
  if (target !== legacyTarget) rules.push({ effectiveFrom: shiftDate(today, 1), targets: normalizeTargets({ ...DEFAULT_TARGETS, puzzles: legacyTarget }) });
  return { version: 1, startedOn: today, revision: 0, nextReviewRevision: 0, rules, reviews: [], rewards: [] };
}

export function getTargets(practice, date) {
  requireDate(date);
  let low = 0;
  let high = practice.rules.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (practice.rules[middle].effectiveFrom <= date) low = middle + 1;
    else high = middle;
  }
  return { ...practice.rules[Math.max(0, low - 1)].targets };
}

export function configurePractice(practice, today, targets, expectedRevision) {
  checkDay(practice, today);
  checkRevision(practice.revision, expectedRevision);
  const effectiveFrom = shiftDate(today, 1);
  const rules = practice.rules.filter(rule => rule.effectiveFrom !== effectiveFrom).map(rule => ({ ...rule, targets: { ...rule.targets } }));
  rules.push({ effectiveFrom, targets: normalizeTargets(targets) });
  if (rules.length > 10000) throw new Error('Лимит правил программы: 10 000.');
  rules.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return { ...structuredClone(practice), revision: nextRevision(practice.revision), rules };
}

function eligibleGames(games) {
  const { username } = activeProfile();
  const unique = new Map();
  for (const game of games ?? []) {
    if (!game || typeof game.id !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(game.id) ||
        game.username !== username || game.rated !== true || game.variant !== 'standard' ||
        !GAME_TASKS.has(game.speed) || !FINISHED.has(game.status) ||
        !Number.isSafeInteger(game.createdAt) || game.createdAt < 0 ||
        !Number.isSafeInteger(game.lastMoveAt) || game.lastMoveAt < game.createdAt) continue;
    unique.set(game.id, game);
  }
  return [...unique.values()];
}

export function saveReview(practice, games, { gameId, note, expectedRevision }, today, instant) {
  checkDay(practice, today);
  requireGameId(gameId);
  const updatedAt = requireInstant(instant, today);
  const normalizedNote = normalizeNote(note);
  const existing = practice.reviews.find(review => review.gameId === gameId);
  // Keep versions increasing even after a note is deleted and recreated.
  const revision = requireRevision(practice.nextReviewRevision);
  const nextReviewRevision = nextRevision(revision);
  let review;
  if (existing) {
    checkRevision(existing.revision, expectedRevision);
    if (updatedAt < existing.updatedAt) throw new Error('Время правки предшествует сохранённой заметке.');
    review = { ...existing, note: normalizedNote, updatedAt, revision };
  } else {
    if (expectedRevision !== null) throw new Error('Версия заметки изменилась. Обновите программу.');
    const game = eligibleGames(games).find(candidate => candidate.id === gameId);
    if (!game || trainingDay(new Date(game.createdAt)) > today) throw new Error('Выберите известную завершённую рейтинговую стандартную партию.');
    if (practice.reviews.length >= 1000) throw new Error('Лимит заметок: 1 000.');
    review = { gameId, date: today, note: normalizedNote, createdAt: updatedAt, updatedAt, revision };
  }
  return { ...structuredClone(practice), nextReviewRevision, reviews: [...practice.reviews.filter(item => item.gameId !== gameId).map(item => ({ ...item })), review] };
}

export function deleteReview(practice, { gameId, expectedRevision }, today) {
  checkDay(practice, today);
  requireGameId(gameId);
  const existing = practice.reviews.find(review => review.gameId === gameId);
  if (!existing) throw new Error('Версия заметки изменилась. Обновите программу.');
  checkRevision(existing.revision, expectedRevision);
  return { ...structuredClone(practice), reviews: practice.reviews.filter(review => review.gameId !== gameId).map(review => ({ ...review })) };
}

function factsFor(journal, practice, games, today) {
  const dates = new Set();
  const days = new Map(journal.days.map(day => [day.date, day]));
  const gameCounts = new Map();
  const reviewCounts = new Map();
  const active = date => date >= practice.startedOn && date <= today;
  for (const game of eligibleGames(games)) {
    const date = trainingDay(new Date(game.createdAt));
    if (!active(date)) continue;
    dates.add(date);
    if (!gameCounts.has(date)) gameCounts.set(date, {});
    const counts = gameCounts.get(date);
    counts[game.speed] = (counts[game.speed] ?? 0) + 1;
  }
  for (const day of journal.days) if (active(day.date)) dates.add(day.date);
  for (const review of practice.reviews) {
    if (!active(review.date)) continue;
    dates.add(review.date);
    reviewCounts.set(review.date, (reviewCounts.get(review.date) ?? 0) + 1);
  }
  for (const reward of practice.rewards) if (active(reward.date)) dates.add(reward.date);
  return { dates, days, gameCounts, reviewCounts };
}

function tasksOn(practice, facts, date) {
  const targets = getTargets(practice, date);
  const day = facts.days.get(date);
  if (day) targets.puzzles = day.target;
  return TASK_IDS.filter(id => targets[id] > 0).map(id => {
    const current = id === 'puzzles' ? (day?.completedAt != null ? targets[id] : 0)
      : id === 'reviews' ? facts.reviewCounts.get(date) ?? 0 : facts.gameCounts.get(date)?.[id] ?? 0;
    return { id, target: targets[id], current, completed: current >= targets[id],
      source: id === 'puzzles' ? (day?.completedAt != null && day.source === 'auto' ? 'auto' : 'manual') : id === 'reviews' ? 'review' : 'games' };
  });
}

export function reconcilePractice({ journal, practice, games }, today, instant) {
  const earnedAt = requireInstant(instant, today);
  const state = structuredClone(journal ?? initialState(today));
  const program = structuredClone(practice ?? initialPractice(state, today));
  checkDay(program, today);
  if (state.days.some(day => day.date > today) || program.reviews.some(review => review.date > today) || program.rewards.some(reward => reward.date > today)) {
    throw new Error('Системная дата предшествует сохранённым тренировкам. Проверьте время устройства и обновите страницу.');
  }
  state.program.target = state.days.find(day => day.date === today)?.target ?? getTargets(program, today).puzzles;
  const facts = factsFor(state, program, games, today);
  const previous = new Map(program.rewards.map(reward => [reward.id, reward]));
  const rewards = new Map(program.rewards.filter(reward => GAME_TASKS.has(reward.taskId) && reward.date >= program.startedOn && reward.date <= today).map(reward => [reward.id, reward]));
  for (const date of facts.dates) {
    for (const task of tasksOn(program, facts, date)) {
      if (!task.completed) continue;
      const id = `${program.startedOn}:${date}:${task.id}`;
      rewards.set(id, previous.get(id) ?? { id, date, taskId: task.id, points: 20, earnedAt });
    }
  }
  if (rewards.size > 50000) throw new Error('Лимит наград: 50 000.');
  program.rewards = [...rewards.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { journal: state, practice: program };
}

export function practiceSnapshot({ journal, practice, games, sync }, today) {
  requireDate(today);
  const state = journal ?? initialState(today);
  const program = practice ?? initialPractice(state, today);
  const facts = factsFor(state, program, games, today);
  const targets = getTargets(program, today);
  const day = facts.days.get(today);
  if (day) targets.puzzles = day.target;
  const pendingRule = program.rules.find(rule => rule.effectiveFrom > today);
  const totalXp = program.rewards.reduce((sum, reward) => sum + reward.points, 0);
  const coverageStart = sync?.coverageStart ?? null;
  const completedUntil = sync?.completedUntil ?? null;
  const startOfToday = dayStart(today, activeProfile().timeZone);
  const tasks = tasksOn(program, facts, today);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(today, index - 6);
    const scheduled = date >= program.startedOn;
    return { date, scheduled, completed: scheduled && tasksOn(program, facts, date).every(task => task.completed) };
  });
  return {
    profile: { ...state.profile }, date: today,
    program: { id: 'daily-training', title: 'Ежедневная программа', startedOn: program.startedOn, revision: program.revision, targets,
      pending: pendingRule ? { effectiveFrom: pendingRule.effectiveFrom, targets: { ...pendingRule.targets } } : null },
    tasks, rewards: { totalXp, level: 1 + Math.floor(totalXp / 100), nextLevelXp: 100 - totalXp % 100,
      gainedToday: program.rewards.filter(reward => reward.date === today).reduce((sum, reward) => sum + reward.points, 0) },
    week,
    reviewOptions: eligibleGames(games).filter(game => trainingDay(new Date(game.createdAt)) <= today)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, 30)
      .map(({ id, speed, result, createdAt }) => ({ id, speed, result, createdAt })),
    reviews: program.reviews.map(review => ({ ...review })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.gameId.localeCompare(b.gameId)),
    coverage: { coverageStart, completedUntil, partial: !sync || sync.cycleUntil != null || completedUntil === null || completedUntil < startOfToday },
  };
}
