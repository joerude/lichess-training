import { createTrainingService } from './training.js';
import { createHistoryService } from './history.js';
import { createSyncService } from './sync.js';
import { createPracticeService } from './practice.js';
import { createPuzzleService } from './puzzles.js';
import { createLichessClient } from '../data/lichess-client.js';

export function createServices({ repository, now, lichess = createLichessClient(), canAccess }) {
  const practice = createPracticeService({ repository, now });
  const training = createTrainingService({ repository, practice, now });
  const history = createHistoryService({ repository, now });
  const sync = createSyncService({ repository, now, lichess, canAccess });
  const puzzles = createPuzzleService({ repository, practice, lichess, canAccess, now });
  return {
    handle(command) {
      if (!command || typeof command !== 'object') throw new Error('Некорректная команда.');
      if (typeof command.type === 'string' && command.type.startsWith('history.')) return history.handle(command);
      if (typeof command.type === 'string' && command.type.startsWith('sync.')) return sync.handle(command);
      if (typeof command.type === 'string' && command.type.startsWith('program.')) return practice.handle(command);
      if (typeof command.type === 'string' && command.type.startsWith('puzzles.')) return puzzles.handle(command);
      return training.handle(command);
    },
  };
}
