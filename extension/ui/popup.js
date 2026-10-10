import { mountTrainingPage } from './page.js';
import { mountPractice } from './practice.js';

let practice;
let trainingLoaded = false;
const page = mountTrainingPage((snapshot) => {
  if (trainingLoaded || practice?.needsRefresh(snapshot.today.date)) void practice?.refresh();
  trainingLoaded = true;
});
practice = mountPractice({ client: page.client, compact: true, setExternalBusy: page.setExternalBusy });
void practice.refresh();
document.getElementById('open-dashboard').addEventListener('click', async () => {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('ui/dashboard.html') });
    window.close();
  } catch (error) { page.showError(error); }
});
