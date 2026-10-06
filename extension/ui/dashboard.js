import { mountTrainingPage, formatDay, puzzleNoun } from './page.js';
import { mountHistory } from './history.js';
import { mountSync } from './sync.js';

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
  document.getElementById('week-summary').textContent = `Отмечено дней: ${entries.filter((day) => day.completed).length} из ${entries.filter((day) => day.scheduled).length}`;
});

const setPageBusy = page.setExternalBusy;
let externalOperations = 0;
page.setExternalBusy = (value) => {
  externalOperations = Math.max(0, externalOperations + (value ? 1 : -1));
  setPageBusy(externalOperations > 0);
};
const history = mountHistory({ ...page, onImported: () => sync.refresh() });
void history.refresh();
const sync = mountSync({ client: page.client, setExternalBusy: page.setExternalBusy,
  onHistoryChanged: () => history.refresh() });
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
    if (file.size > 2 * 1024 * 1024) throw new Error('Файл больше 2 МиБ. Выберите резервную копию меньшего размера.');
    const backup = JSON.parse(await file.text());
    if (backup?.format !== 'lichess-training-backup' || backup.version !== 1) throw new Error('Формат или версия резервной копии не поддерживается.');
    const state = backup.state;
    if (state?.profile?.username !== 'sebajun777' || state.profile.timeZone !== 'Asia/Bishkek' || state.program?.id !== 'daily-puzzles') throw new Error('Выберите копию журнала sebajun777 с программой ежедневной тактики и временем Бишкека.');
    if (!Array.isArray(state.days) || state.days.length > 10_000 || !Number.isInteger(state.program.target) || state.program.target < 1 || state.program.target > 500) throw new Error('В файле нет поддерживаемого журнала тренировок.');
    if (state.days.some((day) => !day || typeof day.date !== 'string')) throw new Error('В файле повреждён список дней.');
    const preview = document.getElementById('backup-preview');
    preview.replaceChildren();
    const dates = state.days.map((day) => day.date).sort();
    const fields = [
      ['Файл', file.name], ['Профиль', state.profile.username], ['Часовой пояс', 'Бишкек (UTC+6)'],
      ['Дней в файле', state.days.length], ['С отметкой выполнения', state.days.filter((day) => day.completedAt !== null).length],
      ['Период записей', dates.length ? `${dates[0]} — ${dates.at(-1)}` : 'Нет записей'], ['Ежедневная цель', `${state.program.target} ${puzzleNoun(state.program.target)}`],
    ];
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
