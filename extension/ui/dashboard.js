import { mountTrainingPage, formatDay, puzzleNoun } from './page.js';
import { mountHistory } from './history.js';
import { mountSync } from './sync.js';
import { mountPractice } from './practice.js';
import { createPuzzleReader } from './puzzle-card.js';

let practice;
let trainingLoaded = false;

const page = mountTrainingPage((snapshot) => {
  document.getElementById('completed-days').textContent = snapshot.completedDays;
  const list = document.getElementById('week');
  const entries = [...snapshot.week].sort((a, b) => a.date.localeCompare(b.date));
  const fragment = document.createDocumentFragment();
  for (const day of entries) {
    const item = document.createElement('li');
    item.className = `week-day${day.completed ? ' done' : ''}${day.date === snapshot.today.date ? ' current' : ''}`;
    const weekday = document.createElement('span');
    weekday.className = 'weekday';
    weekday.textContent = formatDay(day.date, { weekday: 'short' });
    const mark = document.createElement('span');
    mark.className = 'day-mark';
    mark.textContent = day.completed ? '✓' : day.scheduled ? '○' : '—';
    mark.setAttribute('aria-hidden', 'true');
    const date = document.createElement('time');
    date.dateTime = day.date;
    date.textContent = formatDay(day.date, { day: 'numeric', month: 'short' });
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.textContent = day.completed ? 'Выполнено' : day.scheduled ? 'Не отмечено' : 'До начала программы';
    if (day.date === snapshot.today.date) status.textContent += ', сегодня';
    item.append(weekday, mark, date, status);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
  if (trainingLoaded || practice?.needsRefresh(snapshot.today.date)) void practice?.refresh();
  trainingLoaded = true;
  document.getElementById('week-summary').textContent = `Отмечено дней: ${entries.filter((day) => day.completed).length} из ${entries.filter((day) => day.scheduled).length}`;
});

const setPageBusy = page.setExternalBusy;
let externalOperations = 0;
page.setExternalBusy = (value) => {
  externalOperations = Math.max(0, externalOperations + (value ? 1 : -1));
  setPageBusy(externalOperations > 0);
};
practice = mountPractice({ client: page.client, setExternalBusy: page.setExternalBusy });
void practice.refresh();
// The dashboard takes the day's puzzle reading too, so counting starts whichever page is opened first.
const puzzles = createPuzzleReader({ client: page.client, onError: error => page.showError(error), onAutoComplete() {
  void page.controller.refresh();
  void practice.refresh();
} });
void puzzles.refresh();
window.addEventListener('focus', () => { void puzzles.refresh(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void puzzles.refresh(); });
document.querySelector('#today-card a[href="https://lichess.org/training"]').addEventListener('click', () => { void puzzles.refresh(); });
const history = mountHistory({ ...page, onImported: () => Promise.all([sync.refresh(), practice.refresh()]) });
void history.refresh();
const sync = mountSync({ client: page.client, setExternalBusy: page.setExternalBusy,
  onHistoryChanged: () => Promise.all([history.refresh(), practice.refresh()]) });
void sync.refresh();

document.getElementById('export').addEventListener('click', async () => {
  page.setExternalBusy(true);
  try {
    const backup = await page.client.request({ type: 'training.export' });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lichess-training-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    page.showSuccess('Резервная копия подготовлена. Проверьте скачанный файл.');
  } catch (error) { page.showError(error); }
  finally { page.setExternalBusy(false); }
});

const fileInput = document.getElementById('backup-file');
const dialog = document.getElementById('restore-dialog');
const replace = document.getElementById('replace');
const cancel = document.getElementById('cancel-restore');
const restoreError = document.getElementById('restore-error');
let candidate = null;
let restoring = false;

document.getElementById('restore').addEventListener('click', () => {
  candidate = null;
  fileInput.value = '';
  fileInput.click();
});
fileInput.addEventListener('change', async () => {
  candidate = null;
  const file = fileInput.files[0];
  if (!file) return;
  page.setExternalBusy(true);
  try {
    if (file.size > 16 * 1024 * 1024) throw new Error('Файл больше 16 МиБ. Выберите резервную копию меньшего размера.');
    const backup = JSON.parse(await file.text());
    const validated = await page.client.request({ type: 'training.previewImport', backup });
    const preview = document.getElementById('backup-preview');
    preview.replaceChildren();
    const fields = [
      ['Файл', file.name], ['Версия копии', validated.version], ['Профиль', validated.profile.username],
      ['Часовой пояс', 'Бишкек (UTC+6)'], ['Создана', validated.exportedAt],
      ['Дней в файле', validated.days], ['С отметкой задач', validated.completedDays],
      ['Цель задач', `${validated.puzzleTarget} ${puzzleNoun(validated.puzzleTarget)}`],
      ['Начало отметок задач', validated.programStartedOn || 'Не задано'],
      ['Начало ежедневной программы', validated.startedOn || 'Текущая программа сохраняется'],
      ['Правил норм', validated.ruleCount], ['Собственных разборов', validated.reviewCount], ['XP', validated.totalXp],
    ];
    document.getElementById('restore-description').textContent = validated.replacesPractice
      ? 'Эта копия заменит отметки задач, ежедневную программу, нормы, собственные разборы и награды. История партий, рейтинги и состояние загрузки сохраняются. Скачайте текущую копию, если хотите сохранить обе версии.'
      : 'Копия версии 1 заменит только отметки задач. Текущая ежедневная программа, нормы и собственные разборы сохраняются; XP за задачи пересчитается. История партий, рейтинги и состояние загрузки сохраняются.';
    for (const [label, value] of fields) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      preview.append(term, detail);
    }
    candidate = backup;
    restoreError.hidden = true;
    dialog.showModal();
    cancel.focus();
  } catch (error) {
    page.showError(error instanceof SyntaxError ? new Error('Не удалось прочитать JSON. Выберите файл, скачанный из этого журнала.') : error);
  } finally { page.setExternalBusy(false); }
});
cancel.addEventListener('click', () => { if (!restoring) dialog.close(); });
dialog.addEventListener('cancel', (event) => { if (restoring) event.preventDefault(); });
dialog.addEventListener('close', () => { candidate = null; fileInput.value = ''; });
replace.addEventListener('click', async () => {
  if (!candidate || restoring) return;
  restoring = true;
  replace.disabled = true;
  cancel.disabled = true;
  restoreError.hidden = true;
  try {
    const restored = await page.controller.mutate({ type: 'training.import', backup: candidate }, 'Резервная копия восстановлена. Журнал сохранён.');
    if (restored) dialog.close();
    else {
      restoreError.textContent = document.getElementById('error').textContent;
      restoreError.hidden = false;
    }
  } finally {
    restoring = false;
    replace.disabled = false;
    cancel.disabled = false;
  }
});
