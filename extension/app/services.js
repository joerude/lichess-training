import { createTrainingService } from './training.js';
import { createHistoryService } from './history.js';

export function createServices({ repository, now }) {
  const training = createTrainingService({ repository, now });
  const history = createHistoryService({ repository, now });
  return {
    handle(command) {
      if (!command || typeof command !== 'object') throw new Error('Некорректная команда.');
      return typeof command.type === 'string' && command.type.startsWith('history.')
        ? history.handle(command) : training.handle(command);
    },
  };
}
