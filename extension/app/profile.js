import {
  normalizeProfile, setActiveProfile, clearActiveProfile, hasActiveProfile, activeProfile,
} from '../core/profile.js';
import { trainingDay, initialState } from '../core/training-engine.js';

const RESET_WORD = 'удалить';
const ALREADY_SET = 'Профиль уже задан. Чтобы сменить его, удалите данные в разделе «Профиль».';

// The profile of the background: setting it up, loading it from the journal and removing it with all data.
export function createProfileService({ repository, now = () => new Date() }) {
  // Setup, reset and the first load run one at a time, so no command ever sees a half-changed profile.
  let tail = Promise.resolve();
  function exclusive(task) {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  }

  async function get() {
    const journal = await repository.read();
    return { profile: journal === null ? null : normalizeProfile(journal.profile) };
  }

  async function setup(command) {
    const profile = normalizeProfile(command);
    // The stored journal, not the profile in memory, tells whether one is already chosen.
    if (await repository.read() !== null) throw new Error(ALREADY_SET);
    const previous = hasActiveProfile() ? activeProfile() : null;
    // The journal is written for the active profile, so it has to be set first and taken back if the write fails.
    setActiveProfile(profile);
    try {
      const today = trainingDay(new Date(now().getTime()));
      // Checked again inside the write: a journal created in the meantime is never replaced.
      await repository.transact(current => {
        if (current !== null) throw new Error(ALREADY_SET);
        return initialState(today);
      });
    } catch (error) {
      if (previous) setActiveProfile(previous);
      else clearActiveProfile();
      throw error;
    }
    return { profile: activeProfile() };
  }

  async function reset(command) {
    if (command.confirm !== RESET_WORD) throw new Error(`Для удаления данных введите слово «${RESET_WORD}».`);
    // Forgetting the profile first moves its generation on, so a reply still on its way is never written into the
    // emptied store; if clearing fails, the data is still there and so is its profile.
    const previous = hasActiveProfile() ? activeProfile() : null;
    clearActiveProfile();
    try {
      await repository.clearAll();
    } catch (error) {
      if (previous) setActiveProfile(previous);
      throw error;
    }
    return { profile: null };
  }

  return {
    async handle(command) {
      if (!command || typeof command !== 'object') throw new Error('Некорректная команда профиля.');
      return exclusive(() => {
        switch (command.type) {
          case 'profile.get': return get();
          case 'profile.setup': return setup(command);
          case 'profile.reset': return reset(command);
          default: throw new Error('Неизвестная команда профиля.');
        }
      });
    },

    // Runs before every other command: after a restart the profile comes back from the journal (once, then it is
    // kept in memory); without a journal the command fails with profile-required instead of working for nobody.
    async ensure() {
      // A setup or reset that is already running finishes first, so nothing runs against its half-done state.
      await tail;
      if (hasActiveProfile()) return;
      await exclusive(async () => {
        // Simultaneous first commands queue here; the first one loads, the others find it loaded.
        if (hasActiveProfile()) return;
        const journal = await repository.read();
        // No journal, no profile to load: activeProfile() reports it as profile-required.
        if (journal === null) activeProfile();
        else setActiveProfile(journal.profile);
      });
    },
  };
}
