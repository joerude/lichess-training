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
        const request = indexedDB.open(name, 2);
        let blocked = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
          if (!db.objectStoreNames.contains('games')) {
            const games = db.createObjectStore('games', { keyPath: 'id' });
            games.createIndex('speed', 'speed');
            games.createIndex('createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('ratings')) db.createObjectStore('ratings', { keyPath: 'name' });
          if (!db.objectStoreNames.contains('historyMeta')) db.createObjectStore('historyMeta');
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
          blocked = true;
          reject(new Error('Обновление базы заблокировано. Закройте другие страницы расширения и повторите попытку.'));
        };
        request.onsuccess = () => {
          const database = request.result;
          if (blocked) { database.close(); return; }
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

  async function readHistory() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['games', 'ratings', 'historyMeta'], 'readonly');
      const history = { games: [], ratings: [], meta: null };
      for (const store of ['games', 'ratings']) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => { history[store] = request.result; };
      }
      const meta = transaction.objectStore('historyMeta').get('import');
      meta.onsuccess = () => { history.meta = meta.result ?? null; };
      transaction.oncomplete = () => resolve(history);
      transaction.onabort = () => reject(transaction.error || new Error('Чтение истории отменено.'));
      transaction.onerror = () => {};
    });
  }

  async function importHistory(input) {
    const batch = structuredClone(input);
    if (!batch || !Array.isArray(batch.games) || (batch.ratings !== null && !Array.isArray(batch.ratings)) ||
        !batch.meta || typeof batch.meta !== 'object' || Array.isArray(batch.meta)) {
      throw new Error('Неверный пакет истории.');
    }
    const ids = new Set();
    Array.from(batch.games, game => {
      if (!game || typeof game.id !== 'string' || !game.id || ids.has(game.id)) throw new Error('Неверный или повторяющийся ID партии.');
      ids.add(game.id);
    });
    if (batch.ratings !== null) Array.from(batch.ratings, series => {
      if (!series || typeof series.name !== 'string' || !series.name) throw new Error('Неверная серия рейтинга.');
    });
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['games', 'ratings', 'historyMeta'], 'readwrite');
      const games = transaction.objectStore('games');
      let previousCount = 0;
      let added = 0;
      let existing = 0;
      let failure;
      const count = games.count();
      count.onsuccess = () => { previousCount = count.result; };
      try {
        for (const game of batch.games) {
          const request = games.get(game.id);
          request.onsuccess = () => {
            try {
              if (request.result === undefined) { games.put(game); added += 1; }
              else existing += 1;
            } catch (error) { failure = error; transaction.abort(); }
          };
        }
        if (batch.ratings !== null) {
          const ratings = transaction.objectStore('ratings');
          for (const series of batch.ratings) ratings.put(series);
        }
        transaction.objectStore('historyMeta').put(batch.meta, 'import');
      } catch (error) { failure = error; transaction.abort(); }
      transaction.oncomplete = () => resolve({ added, existing, total: previousCount + added });
      transaction.onabort = () => reject(failure || transaction.error || new Error('Сохранение истории отменено.'));
      transaction.onerror = () => {};
    });
  }

  return { read, transact, readHistory, importHistory };
}
