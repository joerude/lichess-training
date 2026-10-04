import { trainingDay, initialState, setCompletion, snapshotFrom, normalizeBackup, backupFrom } from '../core/training-engine.js';

export function createTrainingService({ repository, now = () => new Date() }) {
  async function handle(command) {
    // Capture once before any asynchronous storage work; use the same instant throughout.
    const instant = new Date(now().getTime());
    const today = trainingDay(instant);
    if (!command || typeof command !== 'object') throw new Error('Некорректная команда.');
    let state;
    switch (command.type) {
      case 'training.getSnapshot':
      case 'training.export':
        state = await repository.transact(current => current ?? initialState(today));
        break;
      case 'training.setCompletion':
        if (typeof command.completed !== 'boolean') throw new Error('Некорректный статус завершения.');
        if (command.day !== today) throw new Error('Тренировочный день изменился. Обновите страницу и повторите действие.');
        state = await repository.transact(current => setCompletion(current ?? initialState(today), today, command.completed, instant));
        break;
      case 'training.import': {
        // All validation happens before starting the replacement transaction.
        const restored = normalizeBackup(command.backup, today);
        state = await repository.transact(() => restored);
        break;
      }
      default:
        throw new Error('Неизвестная команда.');
    }
    return command.type === 'training.export' ? backupFrom(state, instant) : snapshotFrom(state, today);
  }

  return { handle };
}
