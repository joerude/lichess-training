import { createRepository } from './data/repository.js';
import { createServices } from './app/services.js';
import { registerTrainingMessages } from './background-transport.js';

const service = createServices({ repository: createRepository() });
registerTrainingMessages(browser.runtime, service);
