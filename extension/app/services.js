import { createProfileService } from './profile.js';
import { createTrainingService } from './training.js';
import { createHistoryService } from './history.js';
import { createSyncService } from './sync.js';
import { createPracticeService } from './practice.js';
import { createPuzzleService } from './puzzles.js';
import { createLichessClient } from '../data/lichess-client.js';

export function createServices({ repository, now, lichess = createLichessClient(), canAccess }) {
  const profile = createProfileService({ repository, now });
  const practice = createPracticeService({ repository, now });
  const training = createTrainingService({ repository, practice, now });
  const history = createHistoryService({ repository, now });
  const sync = createSyncService({ repository, now, lichess, canAccess });
  const puzzles = createPuzzleService({ repository, practice, lichess, canAccess, now });
  return {
    async handle(command) {
      if (!command || typeof command !== 'object') throw new Error('Некорректная команда.');
      const type = typeof command.type === 'string' ? command.type : '';
      if (type.startsWith('profile.')) return profile.handle(command);
      // Every other command works for the profile of the journal; without one it stops before touching any storage.
      await profile.ensure();
      if (type.startsWith('history.')) return history.handle(command);
      if (type.startsWith('sync.')) return sync.handle(command);
      if (type.startsWith('program.')) return practice.handle(command);
      if (type.startsWith('puzzles.')) return puzzles.handle(command);
      return training.handle(command);
    },
  };
}
