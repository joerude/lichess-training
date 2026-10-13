import { readFile } from 'node:fs/promises';
import { parseDataset } from '../extension/data/dataset-import.js';
import { buildHistoryOverview } from '../extension/core/history-statistics.js';
import { setActiveProfile } from '../extension/core/profile.js';

const [username, gamesPath, ratingsPath] = process.argv.slice(2);
if (!username || !gamesPath) {
  process.stderr.write('Использование: npm run inspect:dataset -- <логин> games_raw.ndjson [rating_history.json]\n');
  process.exitCode = 2;
} else {
  try {
    // The overview dates derived ratings by day, which needs a time zone: the one of this machine.
    const profile = setActiveProfile({ username, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const [gamesText, ratingsText] = await Promise.all([
      readFile(gamesPath, 'utf8'), ratingsPath ? readFile(ratingsPath, 'utf8') : null,
    ]);
    const parsed = parseDataset(gamesText, ratingsText, profile.username);
    const overview = buildHistoryOverview({ games: parsed.games, ratings: parsed.ratings ?? [], meta: null });
    process.stdout.write(`${JSON.stringify({ report: parsed.report, groups: overview.groups,
      ratings: overview.ratings.map(series => ({ name: series.name, points: series.points.length,
        first: series.points[0] ?? null, last: series.points.at(-1) ?? null })) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
