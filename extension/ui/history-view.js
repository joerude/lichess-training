import { formatShortDate, zoneLabel } from './time-zone.js';

const integer = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const labels = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' };
const svgNamespace = 'http://www.w3.org/2000/svg';
function date(value) { return value == null ? '—' : formatShortDate(value); }
function day(value) { return dayFormatter.format(new Date(`${value}T00:00:00Z`)); }
function period(first, last) { return first == null || last == null ? 'нет партий' : `${date(first)} — ${date(last)}`; }
function node(document, name, text, className) {
  const element = document.createElement(name);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function renderHistoryPreview(container, preview) {
  container.hidden = !preview;
  container.replaceChildren();
  if (!preview) return;
  const document = container.ownerDocument;
  const list = node(document, 'dl', undefined, 'history-preview-list');
  for (const [label, value] of [
    ['Строк партий', integer.format(preview.rows)], ['Уникальных партий', integer.format(preview.unique)],
    ['Повторов в файле', integer.format(preview.duplicates)], ['Пропущено', integer.format(preview.skipped)],
    ['Период партий', period(preview.firstGameAt, preview.lastGameAt)], ['Точек рейтинга', integer.format(preview.ratingPoints)],
  ]) list.append(node(document, 'dt', label), node(document, 'dd', value));
  container.append(node(document, 'h3', 'Файлы проверены'), list,
    node(document, 'p', 'Сохранение добавит только отсутствующие партии. Исторический анализ не создаёт отметки тренировок.', 'caption'));
}

export function renderHistoryOverview(panel, overview) {
  const document = panel.ownerDocument;
  const find = (id) => panel.querySelector(`#${id}`);
  find('history-period').textContent = overview.totalGames
    ? `${integer.format(overview.totalGames)} партий · ${period(overview.firstGameAt, overview.lastGameAt)} (${zoneLabel()})`
    : 'История партий пока пуста. Выберите исходные файлы ниже и проверьте их перед сохранением.';
  const metadata = find('history-metadata');
  metadata.hidden = !overview.importedAt;
  metadata.textContent = overview.importedAt
    ? `Последний импорт файлов: ${date(overview.importedAt)}${overview.sourceName ? ` · ${overview.sourceName}` : ''}. Партии из файлов и Lichess входят в общую статистику.`
    : '';
  const rows = document.createDocumentFragment();
  for (const speed of ['bullet', 'blitz', 'rapid']) {
    const group = overview.groups.find((entry) => entry.speed === speed);
    const games = group?.games || 0;
    const row = node(document, 'tr');
    const heading = node(document, 'th', labels[speed]);
    heading.scope = 'row';
    row.append(heading);
    const analysed = group?.analysed || 0;
    const rating = group?.lastRating == null ? '—' : `${integer.format(group.lastRating)}${group.ratingDate ? ` · ${day(group.ratingDate)}` : ''}`;
    for (const value of [integer.format(games), `${integer.format(group?.wins || 0)} / ${integer.format(group?.losses || 0)} / ${integer.format(group?.draws || 0)}`,
      group?.winRate == null ? '—' : `${decimal.format(group.winRate)}%`,
      `${integer.format(analysed)} из ${integer.format(games)}${games ? ` (${decimal.format(analysed / games * 100)}%)` : ' (—)'}`, rating]) {
      row.append(node(document, 'td', value));
    }
    rows.append(row);
  }
  find('history-stats').replaceChildren(rows);
  find('history-table').hidden = overview.totalGames === 0;
}

export function ratingChartData(ratings, name) {
  const width = 640, height = 220;
  const points = [...(ratings.find((series) => series.name === name)?.points || [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return { width, height, points: [], minRating: null, maxRating: null };
  let minRating = Infinity, maxRating = -Infinity;
  for (const point of points) {
    minRating = Math.min(minRating, point.rating);
    maxRating = Math.max(maxRating, point.rating);
  }
  const start = Date.parse(`${points[0].date}T00:00:00Z`);
  const duration = Date.parse(`${points.at(-1).date}T00:00:00Z`) - start;
  return { width, height, minRating, maxRating, points: points.map((point) => ({ ...point,
    x: duration ? 52 + (Date.parse(`${point.date}T00:00:00Z`) - start) / duration * (width - 76) : width / 2,
    y: maxRating === minRating ? height / 2 : 24 + (maxRating - point.rating) / (maxRating - minRating) * (height - 58),
  })) };
}

export function renderRatingChart(container, ratings, name) {
  const document = container.ownerDocument;
  const data = ratingChartData(ratings, name);
  container.replaceChildren();
  if (!data.points.length) {
    container.append(node(document, 'p', `Для ${name} нет точек рейтинга. Добавьте rating_history.json при импорте.`, 'muted history-chart-empty'));
    return;
  }
  const first = data.points[0], last = data.points.at(-1);
  const summary = data.points.length === 1
    ? `${name}: одна точка — ${day(first.date)}, рейтинг ${integer.format(first.rating)}.`
    : `${name}: ${day(first.date)} — ${day(last.date)}. Начало: ${integer.format(first.rating)}; конец: ${integer.format(last.rating)}. Диапазон: ${integer.format(data.minRating)}–${integer.format(data.maxRating)}. Точек: ${integer.format(data.points.length)}.`;
  function svgNode(name, attributes = {}, text) {
    const element = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const svg = svgNode('svg', { viewBox: `0 0 ${data.width} ${data.height}`, role: 'img', 'aria-label': summary, class: 'history-rating-chart' });
  svg.append(svgNode('title', {}, `Исторический рейтинг ${name}`), svgNode('desc', {}, summary));
  const levels = data.minRating === data.maxRating ? [data.points[0].y] : [24, data.height - 34];
  for (const y of levels) svg.append(svgNode('line', { x1: 52, x2: data.width - 24, y1: y, y2: y, class: 'history-chart-grid' }));
  svg.append(svgNode('text', { x: 44, y: levels[0] + 4, 'text-anchor': 'end', class: 'history-chart-label' }, integer.format(data.maxRating)));
  if (levels.length > 1) svg.append(svgNode('text', { x: 44, y: levels[1] + 4, 'text-anchor': 'end', class: 'history-chart-label' }, integer.format(data.minRating)));
  if (data.points.length > 1) svg.append(svgNode('polyline', { points: data.points.map((point) => `${point.x},${point.y}`).join(' '), class: 'history-chart-line' }));
  for (const point of data.points.length === 1 ? [first] : [first, last]) svg.append(svgNode('circle', { cx: point.x, cy: point.y, r: 4, class: 'history-chart-point' }));
  container.append(svg, node(document, 'p', summary, 'caption history-chart-summary'));
}
