import { createRepository } from './data/repository.js';
import { createServices } from './app/services.js';
import { registerTrainingMessages } from './background-transport.js';

const service = createServices({
  repository: createRepository(),
  canAccess: () => browser.permissions.contains({
    origins: ['https://lichess.org/*'], data_collection: ['authenticationInfo'],
  }),
});
registerTrainingMessages(browser.runtime, service);
