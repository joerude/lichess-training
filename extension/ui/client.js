// onProfileRequired runs once when the background reports that the profile is gone (for example, deleted in another tab).
export function createClient(runtime = browser.runtime, { onProfileRequired } = {}) {
  let notified = false;
  return {
    async request(command) {
      const result = await runtime.sendMessage(command);
      if (result?.ok === true && Object.hasOwn(result, 'data')) return result.data;
      if (result?.ok === false && typeof result.error === 'string') {
        const error = new Error(result.error);
        if (typeof result.code === 'string') error.code = result.code;
        if (error.code === 'profile-required' && !notified && onProfileRequired) {
          notified = true;
          onProfileRequired();
        }
        throw error;
      }
      throw new Error('Расширение не ответило. Откройте журнал заново и повторите попытку.');
    },
  };
}

export function nextDayDelay(now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = formatter.format(now);
  const start = now.getTime();
  let left = start;
  let right = start + 36 * 60 * 60 * 1000;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (formatter.format(new Date(middle)) === today) left = middle;
    else right = middle;
  }
  return right - start + 50;
}

// One page serializes its reads and writes; the repository serializes all pages.
export function createTrainingController({ client, render, setBusy, showError, showSuccess }) {
  let tail = Promise.resolve();
  let tasks = 0;
  let writing = false;

  function enqueue(command, success) {
    tasks += 1;
    setBusy(true);
    const operation = tail.then(async () => {
      try {
        const snapshot = await client.request(command);
        render(snapshot);
        if (success) showSuccess(success);
        return true;
      } catch (error) {
        showError(error, command.type);
        return false;
      } finally {
        tasks -= 1;
        setBusy(tasks > 0);
      }
    });
    tail = operation;
    return operation;
  }

  return {
    refresh() {
      // A wake/focus request must not reuse a snapshot requested before sleep.
      return enqueue({ type: 'training.getSnapshot' });
    },
    async mutate(command, success = 'Изменения сохранены.') {
      if (writing) return false;
      writing = true;
      try { return await enqueue(command, success); }
      finally { writing = false; }
    },
  };
}
