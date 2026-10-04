import { createClient, createTrainingController, nextDayDelay } from './client.js';

export function formatDay(day, options = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

export function puzzleNoun(count) {
  if (count % 100 >= 11 && count % 100 <= 14) return 'задач';
  if (count % 10 === 1) return 'задача';
  if (count % 10 >= 2 && count % 10 <= 4) return 'задачи';
  return 'задач';
}

export function createPageFeedback({ errorBox, notice }) {
  let errorSource = null;
  return {
    showError(error, source = 'external') {
      errorSource = source;
      notice.hidden = true;
      errorBox.textContent = `${error.message || 'Не удалось открыть журнал.'} Нажмите «Обновить», чтобы повторить. Если ошибка сохраняется, проверьте доступность хранилища Firefox.`;
      errorBox.hidden = false;
    },
    showSuccess(message) {
      errorSource = null;
      errorBox.hidden = true;
      notice.textContent = message;
      notice.hidden = false;
    },
    recoveredSnapshot() {
      if (errorSource === 'training.getSnapshot') {
        errorSource = null;
        errorBox.hidden = true;
      }
    },
  };
}

export function mountTrainingPage(renderExtra = () => {}) {
  const client = createClient();
  const completion = document.getElementById('completion');
  const refresh = document.getElementById('refresh');
  const errorBox = document.getElementById('error');
  const notice = document.getElementById('notice');
  const card = document.getElementById('today-card');
  let snapshot = null;
  let timer;
  let busy = false;
  let externalBusy = false;

  function updateControls() {
    completion.disabled = busy || externalBusy || !snapshot;
    refresh.disabled = busy || externalBusy;
    for (const button of document.querySelectorAll('[data-write-control]')) button.disabled = busy || externalBusy || !snapshot;
    card.setAttribute('aria-busy', String(busy));
  }
  const feedback = createPageFeedback({ errorBox, notice });
  const { showSuccess } = feedback;
  function showError(error, source) {
    if (!snapshot) document.getElementById('today-status').textContent = 'Журнал пока недоступен';
    feedback.showError(error, source);
  }
  function scheduleBoundary() {
    clearTimeout(timer);
    const timeZone = snapshot?.profile.timeZone || 'Asia/Bishkek';
    timer = setTimeout(async () => {
      await controller.refresh();
      scheduleBoundary();
    }, nextDayDelay(new Date(), timeZone));
  }
  const controller = createTrainingController({
    client,
    setBusy(value) { busy = value; updateControls(); },
    showError,
    showSuccess,
    render(value) {
      snapshot = value;
      feedback.recoveredSnapshot();
      document.getElementById('username').textContent = value.profile.username;
      const date = document.getElementById('today-date');
      date.textContent = formatDay(value.today.date);
      date.dateTime = value.today.date;
      document.getElementById('target').textContent = value.today.target;
      document.querySelector('.target-unit').textContent = puzzleNoun(value.today.target);
      card.classList.toggle('is-completed', value.today.completed);
      document.getElementById('today-status').textContent = value.today.completed ? '✓ Тренировка выполнена' : '○ Сегодня ещё не отмечено';
      completion.textContent = value.today.completed ? 'Отменить отметку' : `Выполнено: ${value.today.target} ${puzzleNoun(value.today.target)}`;
      completion.setAttribute('aria-pressed', String(value.today.completed));
      renderExtra(value);
      updateControls();
      scheduleBoundary();
    },
  });
  completion.addEventListener('click', () => {
    if (!snapshot || busy || externalBusy) return;
    // Keep the displayed day even if midnight arrives before the service handles it.
    const { date: day, completed } = snapshot.today;
    void controller.mutate({ type: 'training.setCompletion', day, completed: !completed }, completed ? 'Отметка отменена и сохранена.' : 'Тренировка отмечена. Журнал сохранён.');
  });
  refresh.addEventListener('click', async () => {
    errorBox.hidden = true;
    notice.hidden = true;
    await controller.refresh();
  });
  function onResume() {
    if (document.visibilityState === 'visible') {
      scheduleBoundary();
      void controller.refresh();
    }
  }
  window.addEventListener('focus', onResume);
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('pageshow', onResume);
  scheduleBoundary();
  void controller.refresh();
  return { client, controller, showError, showSuccess,
    setExternalBusy(value) { externalBusy = value; updateControls(); },
  };
}
