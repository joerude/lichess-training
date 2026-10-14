import { mountTrainingPage } from './page.js';
import { mountPractice } from './practice.js';
import { mountPuzzleCard } from './puzzle-card.js';
import { createClient } from './client.js';
import { setTimeZone } from './time-zone.js';

function openDashboard(onError) {
  document.getElementById('open-dashboard').addEventListener('click', async () => {
    try {
      await browser.tabs.create({ url: browser.runtime.getURL('ui/dashboard.html') });
      window.close();
    } catch (error) { onError(error); }
  });
}

function mountJournal() {
  document.querySelector('.popup-shell').classList.remove('awaiting-profile');
  let practice;
  let puzzles;
  let trainingLoaded = false;
  const page = mountTrainingPage((snapshot) => {
    if (trainingLoaded || practice?.needsRefresh(snapshot.today.date)) void practice?.refresh();
    trainingLoaded = true;
    void puzzles?.syncCompletion(snapshot.today);
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
  openDashboard(error => page.showError(error));
}

// Without a profile nothing else can work: the popup only points to the main screen, where the profile is set up.
async function start() {
  let profile = null;
  try {
    ({ profile } = await createClient().request({ type: 'profile.get' }));
  } catch (error) {
    const box = document.getElementById('error');
    box.textContent = error.message || 'Не удалось открыть журнал.';
    box.hidden = false;
  }
  if (profile === null) {
    document.getElementById('profile-needed').hidden = false;
    openDashboard((error) => {
      const box = document.getElementById('error');
      box.textContent = error.message;
      box.hidden = false;
    });
    return;
  }
  setTimeZone(profile.timeZone);
  mountJournal();
}

void start();
