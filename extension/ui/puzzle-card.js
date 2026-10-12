import { puzzleNoun } from './page.js';

const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });

export function formatClock(iso) {
  return clock.format(new Date(iso));
}

export function puzzlePhrase({ solved, target, status, completed }) {
  if (status === 'no-permission') return 'Автоподсчёт выключен: подключите Lichess на основном экране';
  if (solved === null) return 'Нет данных Lichess — можно отметить вручную';
  // Reaching the target without a mark means the mark was removed by hand, so no reward is promised.
  if (solved >= target && !completed) return 'Норма набрана — отметка снята вручную';
  if (solved === 0) return `Начнём — ${target} ${puzzleNoun(target)} на сегодня`;
  if (solved > target) return `Сверх нормы: ${solved} ${puzzleNoun(solved)}`;
  if (solved === target) return 'Норма выполнена! +20 XP';
  return `${solved < Math.ceil(target / 2) ? 'Хорошее начало' : 'Так держать'} — осталось ${target - solved}`;
}

// Takes a puzzle reading without drawing it, so pages without the card still start the day's count.
export function createPuzzleReader({ client, onReading = () => {}, onAutoComplete = () => {}, onError = () => {} }) {
  let pending = null;
  return {
    refresh() {
      if (pending) return pending;
      pending = client.request({ type: 'puzzles.refresh' })
        .then(value => {
          onReading(value);
          if (value.autoCompleted) onAutoComplete();
          return value;
        })
        .catch(error => {
          // Lichess failures arrive as a status; a rejected request is a storage or clock problem worth showing.
          onError(error);
          return null;
        })
        .finally(() => { pending = null; });
      return pending;
    },
  };
}

export function mountPuzzleCard({ client, document = globalThis.document, onAutoComplete = () => {}, onError = () => {} }) {
  const box = document.getElementById('puzzle-progress');
  const solvedNode = document.getElementById('puzzle-solved');
  const bar = document.getElementById('puzzle-bar');
  const phrase = document.getElementById('puzzle-phrase');
  const meta = document.getElementById('puzzle-meta');
  let last = null;

  function render(value) {
    const known = value.solved !== null;
    solvedNode.hidden = !known;
    solvedNode.textContent = known ? `${value.solved} / ` : '';
    bar.hidden = !known;
    if (known) {
      bar.max = value.target;
      bar.value = Math.min(value.solved, value.target);
    }
    phrase.textContent = puzzlePhrase(value);
    meta.hidden = !known;
    meta.textContent = known
      ? `счёт с ${formatClock(value.baselineAt)} · обновлено ${formatClock(value.observedAt)}${value.status === 'ok' ? '' : ' · данные могли устареть'}`
      : '';
    box.hidden = false;
  }

  const reader = createPuzzleReader({ client, onAutoComplete,
    onReading(value) { last = value; render(value); },
    onError(error) { render({ solved: null, status: 'offline' }); onError(error); } });

  return {
    refresh: reader.refresh,
    // A mark, an undo or a new day elsewhere in the popup changes which numbers and phrase apply, so the card is re-read.
    syncCompletion({ date, completed }) {
      return last && (last.completed !== completed || last.date !== date) ? reader.refresh() : null;
    },
  };
}
