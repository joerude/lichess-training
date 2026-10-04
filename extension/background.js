import { createRepository } from './data/repository.js';
import { createTrainingService } from './app/training.js';
import { registerTrainingMessages } from './background-transport.js';

const service = createTrainingService({ repository: createRepository() });
registerTrainingMessages(browser.runtime, service);
