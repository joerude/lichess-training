import { nextDayDelay } from './client.js';
import { currentTimeZone, formatDateTime, formatDayNumeric, zoneLabel } from './time-zone.js';

export function createSyncController({ client, render, setBusy, showError, showSuccess, onHistoryChanged }) {
  let tail = Promise.resolve();
  let tasks = 0;
  let running = false;
  let stopRequested = false;

  function enqueue(action, source) {
    tasks += 1;
    if (tasks === 1) setBusy(true);
    const operation = tail.then(async () => {
      try { return await action(); }
      catch (error) {
        showError(error, source);
        if (source === 'sync.nextBatch') {
          try {
            render(await client.request({ type: 'sync.getSnapshot' }), 'sync.getSnapshot');
          } catch {
            // Keep the failed action visible if the local cooldown read also fails.
          }
        }
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
    refresh() {
      return enqueue(async () => {
        render(await client.request({ type: 'sync.getSnapshot' }), 'sync.getSnapshot');
        return true;
      }, 'sync.getSnapshot');
    },
    run(permissionPromise) {
      // Observe rejection immediately: the serial queue may still be reading storage.
      const permission = Promise.resolve(permissionPromise).then(
        (granted) => ({ granted }),
        (error) => ({ granted: false, error }),
      );
      if (running) return Promise.resolve(false);
      running = true;
      stopRequested = false;
      return enqueue(async () => {
        const approval = await permission;
        if (!approval.granted) {
          showError(approval.error || new Error('Разрешение на подключение к Lichess не предоставлено.'), 'sync.permission');
          return false;
        }
        let loaded = 0;
        for (let batch = 0; batch < 5; batch++) {
          if (stopRequested) {
            showSuccess('Загрузка остановлена. Сохранённые партии остаются в журнале. Продолжите загрузку, когда будете готовы.');
            return true;
          }
          const result = await client.request({ type: 'sync.nextBatch' });
          render(result.snapshot, 'sync.nextBatch');
          loaded += result.report.added;
          await onHistoryChanged();
          if (!result.snapshot.permissionGranted) {
            showSuccess('Доступ к Lichess отозван. Загрузка остановлена; уже сохранённые партии остаются в журнале.');
            return true;
          }
          if (!result.report.hasMore) {
            showSuccess(`Загрузка за выбранный период завершена. Добавлено партий: ${loaded}. Счётчики показывают загруженную историю.`);
            return true;
          }
        }
        showSuccess(stopRequested
          ? 'Загрузка остановлена после сохранения текущей порции. Продолжите загрузку, когда будете готовы.'
          : `Сохранено пять порций, добавлено партий: ${loaded}. Период ещё не загружен полностью. Продолжите загрузку.`);
        return true;
      }, 'sync.nextBatch').finally(() => { running = false; });
    },
    stop() { stopRequested = true; },
  };
}

const formatTime = formatDateTime;

export function mountSync({ client, profile, setExternalBusy, onHistoryChanged, document: documentRef = globalThis.document, window: windowRef = globalThis.window, permissions = globalThis.browser?.permissions, now = Date.now, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout }) {
  const element = (id) => documentRef.getElementById(id);
  const panel = element('sync-card');
  const runButton = element('sync-run');
  const stopButton = element('sync-stop');
  const errorBox = element('sync-error');
  const notice = element('sync-notice');
  const retryBox = element('sync-retry');
  let busy = false;
  let loading = false;
  let snapshot = null;
  let errorSource = null;
  let cooldownTimer = null;
  let boundaryTimer = null;
  let active = true;

  function updateControls() {
    if (cooldownTimer !== null) clearTimer(cooldownTimer);
    cooldownTimer = null;
    const remaining = (snapshot?.sync.retryAfter || 0) - now();
    panel.setAttribute('aria-busy', String(busy));
    runButton.disabled = busy || remaining > 0;
    runButton.textContent = loading
      ? 'Загрузка партий…'
      : !snapshot?.permissionGranted ? 'Подключить Lichess'
        : snapshot.sync.cycleUntil !== null ? 'Продолжить загрузку' : 'Обновить с Lichess';
    stopButton.hidden = !loading;
    stopButton.disabled = !loading;
    retryBox.hidden = remaining <= 0;
    if (remaining > 0) {
      retryBox.textContent = `Lichess попросил подождать. Следующая загрузка доступна с ${formatTime(snapshot.sync.retryAfter)} (${zoneLabel()}).`;
      if (active) cooldownTimer = setTimer(updateControls, Math.min(remaining, 2147483647));
    }
  }

  function render(value, source) {
    snapshot = value;
    element('sync-date').textContent = formatDayNumeric(value.today.date);
    element('sync-date').setAttribute('datetime', value.today.date);
    for (const speed of ['bullet', 'blitz', 'rapid']) {
      element(`sync-${speed}`).textContent = String(value.today.groups.find((group) => group.speed === speed)?.games || 0);
    }
    element('sync-total').textContent = `Всего в загруженной истории: ${value.overview.totalGames} партий.`;
    element('sync-coverage').textContent = `${formatTime(value.sync.coverageStart)} (${zoneLabel()}), включительно`;
    element('sync-completed').textContent = value.sync.completedUntil === null
      ? 'Ни один период ещё не загружен полностью'
      : `${formatTime(value.sync.completedUntil)} (${zoneLabel()}), не включая этот момент`;
    element('sync-last-success').textContent = value.sync.lastSuccessAt === null
      ? 'Завершённых загрузок периода ещё нет'
      : `${formatTime(value.sync.lastSuccessAt)} (${zoneLabel()})`;
    element('sync-state').textContent = value.sync.cycleUntil !== null
      ? 'Загрузка периода не завершена. Показаны уже сохранённые партии; остальные ещё могут отсутствовать.'
      : value.sync.completedUntil !== null
        ? 'Указанный период загружен полностью. Новые партии после его границы появятся при следующем обновлении.'
        : value.overview.totalGames === 0
          ? 'В загруженной истории пока нет партий. Подключите Lichess, чтобы загрузить историю.'
          : 'Показана сохранённая история. Полнота загрузки с Lichess пока не подтверждена.';
    if (source === errorSource || (source === 'sync.nextBatch' && errorSource === 'sync.permission')) {
      errorBox.hidden = true;
      errorSource = null;
    }
    updateControls();
    scheduleBoundary();
  }

  function clearBoundary() {
    if (boundaryTimer !== null) clearTimer(boundaryTimer);
    boundaryTimer = null;
  }
  function scheduleBoundary() {
    clearBoundary();
    if (!active) return;
    boundaryTimer = setTimer(async () => {
      boundaryTimer = null;
      if (!active) return;
      await controller.refresh();
      scheduleBoundary();
    }, nextDayDelay(new Date(now()), currentTimeZone()));
  }

  const controller = createSyncController({
    client, render, onHistoryChanged,
    setBusy(value) {
      busy = value;
      if (!busy) loading = false;
      setExternalBusy(value);
      updateControls();
    },
    showError(error, source) {
      errorSource = source;
      notice.hidden = true;
      const advice = source === 'sync.permission'
        ? `Нажмите «Подключить Lichess» и разрешите передачу имени профиля${profile?.username ? ` ${profile.username}` : ''}. Журнал остаётся локальным.`
        : source === 'sync.getSnapshot'
          ? 'Не удалось прочитать сохранённую историю. Повторите обновление страницы.'
          : 'Загрузка остановлена. Уже сохранённые партии остаются в журнале. Повторите загрузку после восстановления доступа.';
      errorBox.textContent = `${error.message || 'Не удалось загрузить партии.'} ${advice}`;
      errorBox.hidden = false;
    },
    showSuccess(message) {
      errorSource = null;
      errorBox.hidden = true;
      notice.textContent = message;
      notice.hidden = false;
    },
  });

  runButton.addEventListener('click', () => {
    let permissionPromise;
    try {
      // Firefox requires this call in the actual user gesture, before any await.
      permissionPromise = permissions.request({ origins: ['https://lichess.org/*'], data_collection: ['authenticationInfo'] });
    } catch (error) { permissionPromise = Promise.reject(error); }
    loading = true;
    notice.hidden = true;
    void controller.run(permissionPromise);
    updateControls();
  });
  stopButton.addEventListener('click', () => {
    controller.stop();
    notice.textContent = 'Остановим загрузку после текущей порции. Её сохранение продолжается.';
    notice.hidden = false;
  });
  function onResume() {
    active = documentRef.visibilityState === 'visible';
    updateControls();
    scheduleBoundary();
    if (active) void controller.refresh();
  }
  windowRef.addEventListener('pagehide', () => {
    active = false;
    clearBoundary();
    if (cooldownTimer !== null) clearTimer(cooldownTimer);
    cooldownTimer = null;
  });
  windowRef.addEventListener('focus', onResume);
  windowRef.addEventListener('pageshow', onResume);
  documentRef.addEventListener('visibilitychange', onResume);
  active = documentRef.visibilityState === 'visible';
  updateControls();
  scheduleBoundary();
  return { async refresh() { await controller.refresh(); } };
}
