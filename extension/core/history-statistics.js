import { trainingDay } from './training-engine.js';

const SPEEDS = ['bullet', 'blitz', 'rapid'];
const NAMES = ['Bullet', 'Blitz', 'Rapid', 'Puzzles'];
const OUTCOMES = { win: 'wins', loss: 'losses', draw: 'draws' };

export function buildHistoryOverview({ games, ratings, meta }) {
  const ordered = [...games].sort((a, b) => a.createdAt - b.createdAt || a.lastMoveAt - b.lastMoveAt || a.id.localeCompare(b.id));
  const groups = SPEEDS.map(speed => ({ speed, games: 0, wins: 0, losses: 0, draws: 0, analysed: 0, winRate: null, lastRating: null, ratingDate: null }));
  const derived = new Map(SPEEDS.map(speed => [speed, new Map()]));
  for (const game of ordered) {
    const group = groups.find(entry => entry.speed === game.speed);
    group.games += 1;
    group[OUTCOMES[game.result]] += 1;
    if (game.analysed) group.analysed += 1;
    if (game.rating !== null && game.ratingDiff !== null) {
      const rating = game.rating + game.ratingDiff;
      const date = trainingDay(new Date(game.createdAt));
      group.lastRating = rating;
      group.ratingDate = date;
      derived.get(game.speed).set(date, rating);
    }
  }
  for (const group of groups) group.winRate = group.games ? group.wins / group.games * 100 : null;
  const history = NAMES.flatMap((name, index) => {
    const supplied = ratings.find(series => series.name === name);
    const recent = index < SPEEDS.length ? [...derived.get(SPEEDS[index])].map(([date, rating]) => ({ date, rating })) : [];
    if (supplied?.points.length) {
      const points = supplied.points.map(point => ({ ...point })).sort((a, b) => a.date.localeCompare(b.date));
      const lastDate = points.at(-1).date;
      return [{ name, points: [...points, ...recent.filter(point => point.date > lastDate)] }];
    }
    const points = recent;
    return points.length ? [{ name, points }] : supplied ? [{ name, points: [] }] : [];
  });
  return {
    totalGames: ordered.length,
    firstGameAt: ordered[0]?.createdAt ?? null,
    lastGameAt: ordered.at(-1)?.createdAt ?? null,
    importedAt: meta?.importedAt ?? null, sourceName: meta?.sourceName ?? null,
    groups, ratings: history,
  };
}
