import { parseDataset } from '../data/dataset-import.js';
import { buildHistoryOverview } from '../core/history-statistics.js';

export function createHistoryService({ repository, now = () => new Date() }) {
  async function handle(command) {
    if (!command || typeof command !== 'object') throw new Error('Некорректная команда истории.');
    if (command.type === 'history.getOverview') return buildHistoryOverview(await repository.readHistory());
    if (!['history.previewImport', 'history.import'].includes(command.type)) throw new Error('Неизвестная команда истории.');
    const parsed = parseDataset(command.gamesText, command.ratingsText ?? null);
    if (command.type === 'history.previewImport') return parsed.report;
    const instant = new Date(now().getTime());
    if (!Number.isFinite(instant.getTime())) throw new Error('Некорректное время импорта.');
    const sourceName = command.sourceName === undefined ? 'games_raw.ndjson' : command.sourceName;
    if (typeof sourceName !== 'string' || !sourceName.trim() || sourceName.length > 255) throw new Error('Некорректное имя исходного файла.');
    const result = await repository.importHistory({ games: parsed.games, ratings: parsed.ratings,
      meta: { importedAt: instant.toISOString(), sourceName: sourceName.trim(), ...parsed.report } });
    const overview = buildHistoryOverview(await repository.readHistory());
    return { overview, report: { ...parsed.report, ...result, total: overview.totalGames } };
  }
  return { handle };
}
