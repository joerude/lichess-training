import { formatDay } from './page.js';

const labels = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', puzzles: 'Задачи', reviews: 'Собственный разбор' };
const targetIds = Object.keys(labels);
const timeFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const loadedAt = (value) => timeFormat.format(new Date(value));

export function mountPractice({ client, setExternalBusy, compact = false, document: documentRef = globalThis.document }) {
  const element = (id) => documentRef.getElementById(id);
  const node = (tag, text, className) => {
    const item = documentRef.createElement(tag);
    if (text !== undefined) item.textContent = String(text);
    if (className) item.className = className;
    return item;
  };
  let snapshot = null;
  let tail = Promise.resolve();
  let tasks = 0;
  let writing = false;
  let goalsDraft = null;
  let reviewDraft = null;
  let reviewButtons = [];

  function controls() {
    element('program-card').setAttribute('aria-busy', String(tasks > 0));
    if (compact) return;
    for (const id of ['goals-save', 'goals-reset', 'review-save', 'review-new']) element(id).disabled = writing || !snapshot;
    for (const id of targetIds) element(`goal-${id}`).disabled = writing || !snapshot;
    element('review-game').disabled = writing || !snapshot;
    element('review-note').disabled = writing || !snapshot;
    for (const button of reviewButtons) button.disabled = writing;
  }
  function error(id, value) {
    const advice = id === 'program-error' ? 'Повторите обновление журнала; показанные данные сохранены.' : 'Черновик сохранён. Обновите данные и при необходимости начните форму заново.';
    element(id).textContent = `${value.message || 'Не удалось сохранить.'} ${advice}`;
    element(id).hidden = false;
  }
  function render(value) {
    snapshot = value;
    const done = value.tasks.filter((task) => task.completed).length;
    element('program-summary').textContent = `${done} из ${value.tasks.length} заданий · ${value.rewards.totalXp} XP · Уровень ${value.rewards.level}`;
    if (compact) return;
    element('program-date').textContent = formatDay(value.date);
    element('program-date').setAttribute('datetime', value.date);
    element('program-xp').textContent = `${value.rewards.totalXp} XP`;
    element('program-level').textContent = `Уровень ${value.rewards.level} · До уровня ${value.rewards.level + 1}: ${value.rewards.nextLevelXp} XP · Сегодня +${value.rewards.gainedToday} XP`;
    element('program-start').textContent = `Программа с ${formatDay(value.program.startedOn)} · За выполненное задание +20 XP`;
    element('program-xp-note').textContent = 'XP за партии сохраняется при восстановлении копии без истории партий. Выполнение заданий и недели считается по доступным фактам; после импорта истории оно обновится.';
    const cards = value.tasks.map((task) => {
      const card = node('li', undefined, `program-task${task.completed ? ' done' : ''}`);
      card.append(node('h3', labels[task.id]), node('p', `${task.current} из ${task.target}`, 'program-count'), node('p', task.completed ? '✓ Выполнено · +20 XP' : '○ В процессе', 'caption'));
      if (task.source === 'games') card.append(node('p', value.coverage.partial ? 'История неполная: показаны известные партии. Число ниже цели может быть неполным.' : `Из сохранённых завершённых rated standard партий, загруженных до ${loadedAt(value.coverage.completedUntil)}.`, 'caption'));
      if (task.source === 'manual') card.append(node('p', 'Задачи засчитываются по счётчику Lichess при открытии popup или отметкой в карточке тактики ниже.', 'caption'));
      if (task.source === 'auto') card.append(node('p', 'Засчитано автоматически по счётчику задач Lichess.', 'caption'));
      if (task.source === 'review') card.append(node('p', 'Сохраните собственную заметку к партии ниже.', 'caption'));
      return card;
    });
    element('program-tasks').replaceChildren(...cards);
    element('program-week').replaceChildren(...value.week.map((day) => {
      const item = node('li', undefined, `week-day${day.completed ? ' done' : ''}${day.date === value.date ? ' current' : ''}`);
      const time = node('time', formatDay(day.date, { day: 'numeric', month: 'short' }));
      time.setAttribute('datetime', day.date);
      item.append(node('span', formatDay(day.date, { weekday: 'short' }), 'weekday'), node('span', day.completed ? '✓' : day.scheduled ? '○' : '—', 'day-mark'), time, node('span', day.completed ? 'Все задания выполнены' : day.scheduled ? 'Не все задания выполнены' : 'До начала программы', 'sr-only'));
      return item;
    }));
    element('program-week-summary').textContent = `Полных дней: ${value.week.filter((day) => day.completed).length} из ${value.week.filter((day) => day.scheduled).length}`;
    element('goals-effective').textContent = value.program.pending ? `Нормы с ${formatDay(value.program.pending.effectiveFrom)}: ${targetIds.map((id) => `${labels[id]} ${value.program.pending.targets[id]}`).join(', ')}` : 'Новые нормы действуют с завтрашнего дня. Сегодняшний и прошлые дни сохраняются.';
    if (!goalsDraft) fillGoals();
    element('review-options').replaceChildren(...value.reviewOptions.map((game) => {
      const option = node('option', `${labels[game.speed]} · ${game.result} · ${game.id}`);
      option.value = game.id;
      return option;
    }));
    reviewButtons = [];
    element('review-list').replaceChildren(...value.reviews.map((review) => {
      const item = node('li', undefined, 'review-entry');
      const link = node('a', `Партия ${review.gameId} ↗`);
      link.href = `https://lichess.org/${review.gameId}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const actions = node('div', undefined, 'review-actions');
      const edit = node('button', 'Редактировать', 'button button-secondary');
      edit.type = 'button';
      edit.disabled = writing;
      edit.addEventListener('click', () => {
        if (writing) return;
        reviewDraft = { day: value.date, expectedRevision: review.revision, gameId: review.gameId };
        element('review-game').value = review.gameId;
        element('review-game').readOnly = true;
        element('review-note').value = review.note;
        element('review-mode').textContent = `Редактирование ${review.gameId}; день разбора ${formatDay(review.date)} сохраняется.`;
        element('review-error').hidden = true;
      });
      const remove = node('button', 'Удалить', 'button button-quiet');
      remove.type = 'button';
      remove.disabled = writing;
      remove.addEventListener('click', () => mutate({ type: 'program.deleteReview', day: value.date, gameId: review.gameId, expectedRevision: review.revision }, 'review-delete-error', () => {
        // An unsaved edit remains available even if its saved note was deleted.
        element('review-notice').textContent = 'Разбор удалён. XP за разбор пересчитан.';
        element('review-notice').hidden = false;
      }));
      reviewButtons.push(edit, remove);
      actions.append(edit, remove);
      item.append(link, node('p', review.note, 'review-text'), node('p', `День разбора: ${formatDay(review.date)}`, 'caption'), actions);
      return item;
    }));
    element('reviews-empty').hidden = value.reviews.length > 0;
    controls();
  }
  function fillGoals() {
    const targets = snapshot.program.pending?.targets || snapshot.program.targets;
    for (const id of targetIds) element(`goal-${id}`).value = String(targets[id]);
    element('goals-draft-day').textContent = '';
  }
  function beginGoals() {
    if (!snapshot || goalsDraft) return;
    goalsDraft = { day: snapshot.date, expectedRevision: snapshot.program.revision };
    element('goals-draft-day').textContent = `Черновик для дня ${formatDay(goalsDraft.day)}. После смены дня или норм начните форму заново.`;
  }
  function beginReview() {
    if (!snapshot || reviewDraft) return;
    reviewDraft = { day: snapshot.date, expectedRevision: null, gameId: null };
  }
  function clearReview() {
    reviewDraft = null;
    element('review-game').value = '';
    element('review-game').readOnly = false;
    element('review-note').value = '';
    element('review-mode').textContent = 'Новый разбор засчитывается в день сохранения. Редактирование сохраняет первоначальный день.';
  }
  function enqueue(command, errorId, success) {
    tasks++;
    if (tasks === 1) setExternalBusy(true);
    controls();
    const operation = tail.then(async () => {
      try {
        const value = await client.request(command);
        success?.();
        render(value);
        element(errorId).hidden = true;
        return true;
      } catch (value) { error(errorId, value); return false; }
      finally {
        tasks--;
        if (tasks === 0) setExternalBusy(false);
        controls();
      }
    });
    tail = operation;
    return operation;
  }
  async function mutate(command, errorId, success) {
    if (!snapshot || writing) return false;
    writing = true;
    controls();
    try { return await enqueue(command, errorId, success); }
    finally { writing = false; render(snapshot); controls(); }
  }
  if (!compact) {
    for (const id of targetIds) element(`goal-${id}`).addEventListener('input', beginGoals);
    element('goals-reset').addEventListener('click', () => {
      if (!snapshot || writing) return;
      goalsDraft = null;
      fillGoals();
      element('goals-error').hidden = true;
    });
    element('goals-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!snapshot || writing) return;
      beginGoals();
      const targets = Object.fromEntries(targetIds.map((id) => [id, Number(element(`goal-${id}`).value)]));
      return mutate({ type: 'program.configure', ...goalsDraft, targets }, 'goals-error', () => {
        goalsDraft = null;
        element('goals-notice').textContent = 'Нормы на завтра сохранены.';
        element('goals-notice').hidden = false;
      });
    });
    element('review-game').addEventListener('input', beginReview);
    element('review-note').addEventListener('input', beginReview);
    element('review-new').addEventListener('click', () => { if (!writing) { clearReview(); element('review-error').hidden = true; } });
    element('review-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!snapshot || writing) return;
      beginReview();
      const gameId = reviewDraft.gameId || element('review-game').value.trim();
      return mutate({ type: 'program.saveReview', day: reviewDraft.day, expectedRevision: reviewDraft.expectedRevision, gameId, note: element('review-note').value }, 'review-error', () => {
        clearReview();
        element('review-notice').textContent = 'Собственный разбор сохранён.';
        element('review-notice').hidden = false;
      });
    });
  }
  controls();
  return {
    needsRefresh: (day) => tasks === 0 && (!snapshot || snapshot.date !== day),
    refresh: () => enqueue({ type: 'program.getSnapshot' }, 'program-error'),
  };
}
