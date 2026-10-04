import { mountTrainingPage } from './page.js';

const page = mountTrainingPage();
document.getElementById('open-dashboard').addEventListener('click', async () => {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('ui/dashboard.html') });
    window.close();
  } catch (error) { page.showError(error); }
});
