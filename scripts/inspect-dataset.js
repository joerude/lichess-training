import { readFile } from 'node:fs/promises';
import { parseDataset } from '../extension/data/dataset-import.js';
import { buildHistoryOverview } from '../extension/core/history-statistics.js';

const [gamesPath, ratingsPath] = process.argv.slice(2);
if (!gamesPath) {
  process.stderr.write('Usage: npm run inspect:dataset -- games_raw.ndjson [rating_history.json]\n');
  process.exitCode = 1;
} else {
  try {
    const [gamesText, ratingsText] = await Promise.all([
      readFile(gamesPath, 'utf8'), ratingsPath ? readFile(ratingsPath, 'utf8') : null,
    ]);
    const parsed = parseDataset(gamesText, ratingsText);
    const overview = buildHistoryOverview({ games: parsed.games, ratings: parsed.ratings ?? [], meta: null });
    process.stdout.write(`${JSON.stringify({ report: parsed.report, groups: overview.groups,
      ratings: overview.ratings.map(series => ({ name: series.name, points: series.points.length,
        first: series.points[0] ?? null, last: series.points.at(-1) ?? null })) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
