import { mountTrainingPage } from './page.js';
import { mountPractice } from './practice.js';
import { mountPuzzleCard } from './puzzle-card.js';

let practice;
let puzzles;
let trainingLoaded = false;
const page = mountTrainingPage((snapshot) => {
  if (trainingLoaded || practice?.needsRefresh(snapshot.today.date)) void practice?.refresh();
  trainingLoaded = true;
  void puzzles?.syncCompletion(snapshot.today.completed);
});
practice = mountPractice({ client: page.client, compact: true, setExternalBusy: page.setExternalBusy });
void practice.refresh();
// Opening the popup takes the day's first reading before any puzzle is solved.
puzzles = mountPuzzleCard({ client: page.client, onError: error => page.showError(error), onAutoComplete() {
  void page.controller.refresh();
  void practice.refresh();
} });
void puzzles.refresh();
document.getElementById('refresh').addEventListener('click', () => { void puzzles.refresh(); });
document.getElementById('open-dashboard').addEventListener('click', async () => {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('ui/dashboard.html') });
    window.close();
  } catch (error) { page.showError(error); }
});
