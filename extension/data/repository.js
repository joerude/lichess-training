function mergeSyncedGame(previous, next) {
  for (const key of ['id', 'username', 'createdAt', 'speed', 'rated', 'variant', 'color']) {
    if (previous[key] !== next[key]) throw new Error('Противоречащие сведения о той же партии.');
  }
  if (previous.opponent.id !== next.opponent.id) throw new Error('У той же партии изменился соперник.');
  if (next.lastMoveAt < previous.lastMoveAt) return previous;
  let analysis = null;
  if (previous.playerAnalysis || next.playerAnalysis) {
    analysis = Object.fromEntries(['acpl', 'inaccuracy', 'mistake', 'blunder'].map(key =>
      [key, next.playerAnalysis?.[key] ?? previous.playerAnalysis?.[key] ?? null]));
  }
  return { ...previous, ...next,
    rating: next.rating ?? previous.rating, ratingDiff: next.ratingDiff ?? previous.ratingDiff,
    moves: next.moves || previous.moves, opening: next.opening ?? previous.opening,
    opponent: { ...previous.opponent, ...next.opponent, rating: next.opponent.rating ?? previous.opponent.rating },
    analysed: previous.analysed || next.analysed, playerAnalysis: analysis };
}

// Journal updates and game synchronization each commit as one transaction.
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

  async function readHistory(includeSync = false) {
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
      if (includeSync) {
        history.sync = null;
        const sync = transaction.objectStore('historyMeta').get('sync');
        sync.onsuccess = () => { history.sync = sync.result ?? null; };
      }
      transaction.oncomplete = () => resolve(history);
      transaction.onabort = () => reject(transaction.error || new Error('Чтение истории отменено.'));
      transaction.onerror = () => {};
    });
  }

  async function practiceTransaction(update) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['journal', 'games', 'historyMeta'], update ? 'readwrite' : 'readonly');
      const journal = transaction.objectStore('journal');
      let result = { journal: null, practice: null, games: [], sync: null, puzzles: null };
      let remaining = 5;
      let failure;
      for (const [key, request] of [
        ['journal', journal.get(stateKey)], ['practice', journal.get('practice')],
        ['games', transaction.objectStore('games').getAll()],
        ['sync', transaction.objectStore('historyMeta').get('sync')],
        ['puzzles', transaction.objectStore('historyMeta').get('puzzles')],
      ]) {
        request.onsuccess = () => {
          result[key] = request.result ?? (key === 'games' ? [] : null);
          if (--remaining !== 0 || !update) return;
          try {
            const records = update(result);
            if (records && typeof records.then === 'function') throw new Error('The practice updater must be synchronous.');
            for (const name of ['journal', 'practice']) {
              if (!records?.[name] || typeof records[name] !== 'object' || Array.isArray(records[name])) {
                throw new Error('Некорректные записи программы.');
              }
            }
            const saved = structuredClone({ journal: records.journal, practice: records.practice });
            journal.put(saved.journal, stateKey);
            journal.put(saved.practice, 'practice');
            // Only a new counter reading is written; passing the read record through leaves it untouched.
            if (records.puzzles != null && records.puzzles !== result.puzzles) {
              if (typeof records.puzzles !== 'object' || Array.isArray(records.puzzles)) throw new Error('Некорректная запись счётчика задач.');
              saved.puzzles = structuredClone(records.puzzles);
              transaction.objectStore('historyMeta').put(saved.puzzles, 'puzzles');
            }
            result = { ...result, ...saved };
          } catch (error) { failure = error; transaction.abort(); }
        };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || transaction.error || new Error('Сохранение программы отменено (abort).'));
      transaction.onerror = () => {};
    });
  }

  async function readPuzzleReading() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('historyMeta', 'readonly');
      const request = transaction.objectStore('historyMeta').get('puzzles');
      let reading = null;
      request.onsuccess = () => { reading = request.result ?? null; };
      transaction.oncomplete = () => resolve(reading);
      transaction.onabort = () => reject(transaction.error || new Error('Чтение счётчика задач отменено.'));
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

  async function saveSyncBatch(input) {
    const batch = structuredClone(input);
    if (!batch || !Array.isArray(batch.games) || !batch.sync ||
        !Number.isSafeInteger(batch.expectedRevision) || batch.expectedRevision < 0 ||
        batch.sync.revision !== batch.expectedRevision + 1) throw new Error('Некорректный пакет обновления.');
    const ids = new Set();
    for (const game of Array.from(batch.games)) {
      if (!game || typeof game.id !== 'string' || !game.id || ids.has(game.id)) throw new Error('Неверный или повторный game ID.');
      ids.add(game.id);
    }
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['games', 'historyMeta'], 'readwrite');
      const games = transaction.objectStore('games');
      const metadata = transaction.objectStore('historyMeta');
      let added = 0, updated = 0, previousCount = 0, failure;
      const current = metadata.get('sync');
      current.onsuccess = () => {
        try {
          if ((current.result?.revision ?? 0) !== batch.expectedRevision) throw new Error('История уже изменена другим экраном. Обновите данные и повторите.');
          const count = games.count();
          count.onsuccess = () => { previousCount = count.result; };
          for (const game of batch.games) {
            const lookup = games.get(game.id);
            lookup.onsuccess = () => {
              try {
                if (!lookup.result) { games.put(game); added += 1; }
                else {
                  const merged = mergeSyncedGame(lookup.result, game);
                  if (JSON.stringify(merged) !== JSON.stringify(lookup.result)) { games.put(merged); updated += 1; }
                }
              } catch (error) { failure = error; transaction.abort(); }
            };
          }
          metadata.put(batch.sync, 'sync');
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve({ added, updated, total: previousCount + added });
      transaction.onabort = () => reject(failure || transaction.error || new Error('Обновление истории отменено.'));
      transaction.onerror = () => {};
    });
  }

  return { read, transact, readHistory: () => readHistory(), readSyncHistory: () => readHistory(true), importHistory, saveSyncBatch,
    readPractice: () => practiceTransaction(),
    readPuzzleReading,
    transactPractice(update) {
      if (typeof update !== 'function') return Promise.reject(new Error('Нужна функция изменения программы.'));
      return practiceTransaction(update);
    },
  };
}
