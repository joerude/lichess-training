import { puzzleNoun } from './page.js';

const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });

export function formatClock(iso) {
  return clock.format(new Date(iso));
}

export function puzzlePhrase({ solved, target, status }) {
  if (solved === null) {
    return status === 'no-permission'
      ? 'Автоподсчёт выключен: подключите Lichess на основном экране'
      : 'Нет данных Lichess — можно отметить вручную';
  }
  if (solved === 0) return `Начнём — ${target} ${puzzleNoun(target)} на сегодня`;
  if (solved > target) return `Сверх нормы: ${solved} ${puzzleNoun(solved)}`;
  if (solved === target) return 'Норма выполнена! +20 XP';
  return `${solved < Math.ceil(target / 2) ? 'Хорошее начало' : 'Так держать'} — осталось ${target - solved}`;
}

export function mountPuzzleCard({ client, document = globalThis.document, onAutoComplete = () => {}, onError = () => {} }) {
  const box = document.getElementById('puzzle-progress');
  const solvedNode = document.getElementById('puzzle-solved');
  const bar = document.getElementById('puzzle-bar');
  const phrase = document.getElementById('puzzle-phrase');
  const meta = document.getElementById('puzzle-meta');
  let pending = null;

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

  return {
    refresh() {
      if (pending) return pending;
      pending = client.request({ type: 'puzzles.refresh' })
        .then(value => {
          render(value);
          if (value.autoCompleted) onAutoComplete();
          return value;
        })
        .catch(error => {
          // Lichess failures arrive as a status; a rejected request is a storage or clock problem worth showing.
          render({ solved: null, status: 'offline' });
          onError(error);
          return null;
        })
        .finally(() => { pending = null; });
      return pending;
    },
  };
}
