import { renderHistoryOverview, renderHistoryPreview, renderRatingChart } from './history-view.js';

export async function readHistoryFiles(gamesFile, ratingsFile) {
  if (!gamesFile) throw new Error('Выберите файл партий games_raw.ndjson, затем нажмите «Проверить файлы».');
  if (gamesFile.size > 20 * 1024 * 1024) throw new Error('Файл партий больше 20 МиБ. Выберите исходный NDJSON меньшего размера.');
  if (ratingsFile?.size > 1024 * 1024) throw new Error('Файл рейтингов больше 1 МиБ. Выберите JSON меньшего размера.');
  const gamesText = await gamesFile.text();
  if (!gamesText.trim()) throw new Error('Файл партий пуст. Выберите NDJSON с партиями.');
  const payload = { gamesText, sourceName: gamesFile.name };
  if (ratingsFile) {
    payload.ratingsText = await ratingsFile.text();
    if (!payload.ratingsText.trim()) throw new Error('Файл рейтингов пуст. Выберите JSON с рейтингами или уберите его из выбора.');
  }
  return payload;
}

// Keep every request in order, and bind the approved preview to its file selection.
export function createHistoryController({ client, renderOverview, renderPreview, setBusy, showError, showSuccess, onImported = async () => {} }) {
  let tail = Promise.resolve();
  let tasks = 0;
  let revision = 0;
  let candidate = null;
  let writing = false;

  function invalidatePreview() {
    revision += 1;
    candidate = null;
    renderPreview(null);
  }
  function enqueue(action, source, isCurrent = () => true) {
    tasks += 1;
    if (tasks === 1) setBusy(true);
    const operation = tail.then(async () => {
      try { return await action(); }
      catch (error) {
        if (isCurrent()) showError(error, source);
        return false;
      } finally {
        tasks -= 1;
        if (tasks === 0) setBusy(false);
      }
    });
    tail = operation;
    return operation;
  }
  return {
    invalidatePreview,
    refresh() {
      return enqueue(async () => {
        renderOverview(await client.request({ type: 'history.getOverview' }));
        return true;
      }, 'history.getOverview');
    },
    previewFiles(gamesFile, ratingsFile) {
      invalidatePreview();
      const selectedRevision = revision;
      const isCurrent = () => revision === selectedRevision;
      return enqueue(async () => {
        if (!isCurrent()) return false;
        const payload = await readHistoryFiles(gamesFile, ratingsFile);
        if (!isCurrent()) return false;
        const preview = await client.request({ type: 'history.previewImport', ...payload });
        if (!isCurrent()) return false;
        candidate = payload;
        renderPreview(preview);
        return true;
      }, 'history.previewImport', isCurrent);
    },
    async import() {
      if (!candidate || writing) return false;
      const approved = candidate;
      writing = true;
      let committed;
      try {
        committed = await enqueue(async () => {
          const result = await client.request({ type: 'history.import', ...approved });
          renderOverview(result.overview);
          invalidatePreview();
          showSuccess(`История сохранена: добавлено ${result.report.added}, уже было ${result.report.existing}. Всего партий: ${result.report.total}.`);
          return true;
        }, 'history.import');
      } finally { writing = false; }
      // Release the mutation guard before another panel schedules its local refresh.
      if (committed) await onImported();
      return committed;
    },
  };
}

export function mountHistory({ client, showSuccess, setExternalBusy, onImported }) {
  const panel = document.getElementById('history-card');
  const gamesFile = document.getElementById('history-games-file');
  const ratingsFile = document.getElementById('history-ratings-file');
  const previewButton = document.getElementById('history-preview-button');
  const importButton = document.getElementById('history-import-button');
  const refreshButton = document.getElementById('history-refresh');
  const clearRatings = document.getElementById('history-clear-ratings');
  const series = document.getElementById('history-rating-series');
  const errorBox = document.getElementById('history-error');
  const notice = document.getElementById('history-notice');
  let busy = false;
  let approved = false;
  let overview = null;
  let errorSource = null;

  function updateControls() {
    panel.setAttribute('aria-busy', String(busy));
    gamesFile.disabled = busy;
    ratingsFile.disabled = busy;
    previewButton.disabled = busy;
    importButton.disabled = busy || !approved;
    refreshButton.disabled = busy;
    clearRatings.disabled = busy || !ratingsFile.files.length;
  }
  const controller = createHistoryController({
    client, onImported,
    setBusy(value) { busy = value; setExternalBusy(value); updateControls(); },
    renderPreview(value) {
      approved = value !== null;
      renderHistoryPreview(document.getElementById('history-preview'), value);
      if (value) {
        errorBox.hidden = true;
        errorSource = null;
      }
      updateControls();
    },
    renderOverview(value) {
      overview = value;
      renderHistoryOverview(panel, value);
      renderRatingChart(document.getElementById('history-chart'), value.ratings, series.value);
      if (errorSource === 'history.getOverview') {
        errorBox.hidden = true;
        errorSource = null;
      }
    },
    showError(error, source) {
      errorSource = source;
      notice.hidden = true;
      const retry = source === 'history.getOverview'
        ? 'Нажмите «Обновить историю», чтобы повторить. Если ошибка сохраняется, проверьте доступность хранилища Firefox.'
        : source === 'history.import'
          ? 'История не сохранена. Повторите сохранение; если ошибка сохраняется, проверьте свободное место и доступность хранилища Firefox.'
          : 'Проверьте выбранные исходные файлы и повторите проверку.';
      errorBox.textContent = `${error.message || 'Не удалось обработать историю.'} ${retry}`;
      errorBox.hidden = false;
    },
    showSuccess(message) {
      errorBox.hidden = true;
      errorSource = null;
      notice.textContent = message;
      notice.hidden = false;
      showSuccess(message);
    },
  });
  function selectionChanged() {
    controller.invalidatePreview();
    notice.hidden = true;
    errorBox.hidden = true;
    errorSource = null;
    updateControls();
  }
  gamesFile.addEventListener('change', selectionChanged);
  ratingsFile.addEventListener('change', selectionChanged);
  clearRatings.addEventListener('click', () => { ratingsFile.value = ''; selectionChanged(); });
  previewButton.addEventListener('click', () => { notice.hidden = true; void controller.previewFiles(gamesFile.files[0], ratingsFile.files[0]); });
  importButton.addEventListener('click', () => { void controller.import(); });
  refreshButton.addEventListener('click', () => { void controller.refresh(); });
  series.addEventListener('change', () => {
    if (overview) renderRatingChart(document.getElementById('history-chart'), overview.ratings, series.value);
  });
  function onResume() {
    if (document.visibilityState === 'visible') void controller.refresh();
  }
  window.addEventListener('focus', onResume);
  window.addEventListener('pageshow', onResume);
  document.addEventListener('visibilitychange', onResume);
  updateControls();
  return { async refresh() { await controller.refresh(); } };
}
