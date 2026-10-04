// One journal record keeps training updates and backup replacement atomic.
export function createRepository({ indexedDB = globalThis.indexedDB, name = 'lichess-training' } = {}) {
  const storeName = 'journal';
  const stateKey = 'state';
  let opening;

  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        if (!indexedDB) {
          reject(new Error('IndexedDB storage is unavailable.'));
          return;
        }
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB storage is blocked by another open connection.'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            opening = undefined;
          };
          resolve(database);
        };
      }).catch(error => {
        opening = undefined;
        throw error;
      });
    }
    return opening;
  }

  async function read() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(stateKey);
      let state = null;
      request.onsuccess = () => { state = request.result ?? null; };
      transaction.oncomplete = () => resolve(state);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB read was aborted.'));
      transaction.onerror = () => {}; // onabort reports the final failure.
    });
  }

  async function transact(update) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(stateKey);
      let saved;
      let failure;
      request.onsuccess = () => {
        try {
          const next = update(request.result ?? null);
          if (next && typeof next.then === 'function') {
            throw new Error('The IndexedDB transaction updater must be synchronous.');
          }
          if (!next || typeof next !== 'object' || Array.isArray(next)) {
            throw new Error('The IndexedDB transaction updater must return a state object.');
          }
          // Clone before resolving, so callers cannot change the result while it commits.
          saved = structuredClone(next);
          store.put(saved, stateKey);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onabort = () => reject(failure || transaction.error || new Error('IndexedDB write was aborted.'));
      transaction.onerror = () => {}; // A failed write must abort; never resolve early.
    });
  }

  return { read, transact };
}
