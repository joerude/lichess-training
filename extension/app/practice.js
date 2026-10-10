import { trainingDay, setCompletion, snapshotFrom } from '../core/training-engine.js';
import { configurePractice, saveReview, deleteReview, reconcilePractice, practiceSnapshot } from '../core/practice-engine.js';
import { normalizePracticeBackup, practiceBackupFrom, practiceBackupPreview } from '../core/practice-backup.js';
import { nextRevision } from '../core/practice-validation.js';

export function createPracticeService({ repository, now = () => new Date() }) {
  function restoredPractice(saved, current) {
    let nextReviewRevision = Math.max(saved.nextReviewRevision, current?.nextReviewRevision ?? 0);
    const reviews = saved.reviews.map(review => {
      const revision = nextReviewRevision;
      nextReviewRevision = nextRevision(revision);
      return { ...review, revision };
    });
    return { ...saved, reviews, nextReviewRevision,
      revision: nextRevision(Math.max(saved.revision, current?.revision ?? 0)) };
  }
  function requireDay(command, today) {
    if (command.day !== today) throw new Error('Тренировочный день изменился. Обновите страницу и повторите действие.');
  }

  async function update(instant, apply = records => records) {
    const today = trainingDay(instant);
    return repository.transactPractice(records => {
      const prepared = { ...records, ...reconcilePractice(records, today, instant) };
      return reconcilePractice({ ...prepared, ...apply(prepared, today) }, today, instant);
    });
  }

  async function handle(command) {
    const instant = new Date(now().getTime());
    const today = trainingDay(instant);
    if (!command || typeof command !== 'object') throw new Error('Некорректная команда программы.');
    if (command.type !== 'program.getSnapshot') requireDay(command, today);
    let records;
    switch (command.type) {
      case 'program.getSnapshot':
        records = await update(instant);
        break;
      case 'program.configure':
        records = await update(instant, current => ({ ...current,
          practice: configurePractice(current.practice, today, command.targets, command.expectedRevision) }));
        break;
      case 'program.saveReview':
        records = await update(instant, current => ({ ...current,
          practice: saveReview(current.practice, current.games, command, today, instant) }));
        break;
      case 'program.deleteReview':
        records = await update(instant, current => ({ ...current,
          practice: deleteReview(current.practice, command, today) }));
        break;
      default:
        throw new Error('Неизвестная команда программы.');
    }
    return practiceSnapshot(records, today);
  }

  async function handleTraining(command, instant) {
    const today = trainingDay(instant);
    // Preview and restore validate the entire file before opening a transaction.
    if (command.type === 'training.previewImport') {
      return practiceBackupPreview(normalizePracticeBackup(command.backup, today));
    }
    let records;
    switch (command.type) {
      case 'training.getSnapshot':
      case 'training.export':
        records = await update(instant);
        break;
      case 'training.setCompletion':
        if (typeof command.completed !== 'boolean') throw new Error('Некорректный статус завершения.');
        requireDay(command, today);
        records = await update(instant, current => ({ ...current,
          journal: setCompletion(current.journal, today, command.completed, instant) }));
        break;
      case 'training.import': {
        const restored = normalizePracticeBackup(command.backup, today);
        records = await repository.transactPractice(current => reconcilePractice({ ...current,
          journal: restored.journal, practice: restored.version === 2 ? restoredPractice(restored.practice, current.practice) : current.practice }, today, instant));
        break;
      }
      default:
        throw new Error('Неизвестная команда.');
    }
    return command.type === 'training.export' ? practiceBackupFrom(records, instant) : snapshotFrom(records.journal, today);
  }

  return { handle, handleTraining };
}
