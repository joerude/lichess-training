const EXPORT_URL = 'https://lichess.org/api/games/user/sebajun777';
const PROFILE_URL = 'https://lichess.org/api/user/sebajun777';
const MAX_BYTES = 8 * 1024 * 1024;
const PROFILE_MAX_BYTES = 1024 * 1024;
const MAX_DATE = 8640000000000000;

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
}

function cancelBody(body, reason) {
  try {
    Promise.resolve(body?.cancel(reason)).catch(() => {});
  } catch {}
}

function cooldownError(retryAt) {
  const error = new Error('Lichess ограничил частоту запросов. Повторите позже.');
  error.retryAt = retryAt;
  return error;
}

function noDataError() {
  const error = new Error('Профиль Lichess не содержит счётчик задач.');
  error.code = 'no-data';
  return error;
}

function retryTime(header, currentTime) {
  let wait = 60000;
  if (header !== null) {
    const value = header.trim();
    const requested = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - currentTime;
    if (Number.isFinite(requested) && validTimestamp(currentTime + Math.max(wait, requested))) {
      wait = Math.max(wait, requested);
    }
  }
  const retryAt = currentTime + wait;
  if (!validTimestamp(retryAt)) throw new Error('Невозможно определить время следующего запроса.');
  return retryAt;
}

// Rejects after timeoutMs and aborts the request; clear() must run once the request settles.
function createDeadline(controller, timeoutMs) {
  let timer;
  const promise = new Promise((resolve, reject) => {
    function schedule(remaining) {
      const duration = Math.min(remaining, 2147483647);
      timer = setTimeout(() => {
        if (remaining > duration) { schedule(remaining - duration); return; }
        const error = new Error('Истекло время ожидания ответа Lichess.');
        reject(error);
        controller.abort(error);
      }, duration);
    }
    schedule(timeoutMs);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

export function createLichessClient({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 30000 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw new Error('Не заданы функции запроса и времени.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Некорректное время ожидания запроса.');

  let queue = Promise.resolve();
  let retryAt = null;
  function readClock() {
    const currentTime = now();
    if (!validTimestamp(currentTime)) throw new Error('Некорректное текущее время.');
    return currentTime;
  }

  // One GET with the shared 429 pause, timeout and body cleanup; consume(read) drains the stream.
  async function request(url, accept, consume) {
    const currentTime = readClock();
    if (retryAt !== null && currentTime < retryAt) throw cooldownError(retryAt);

    const controller = new AbortController();
    const deadline = createDeadline(controller, timeoutMs);
    let reader;
    let body;
    let complete = false;

    try {
      const fetching = Promise.resolve(fetchImpl(url, {
        method: 'GET', headers: { Accept: accept },
        credentials: 'omit', redirect: 'error', signal: controller.signal,
      })).then(response => {
        if (controller.signal.aborted) cancelBody(response.body, controller.signal.reason);
        return response;
      });
      const response = await Promise.race([fetching, deadline.promise]);
      body = response.body;
      if (!response.ok) {
        if (response.status === 429) {
          retryAt = retryTime(response.headers.get('Retry-After'), readClock());
          throw cooldownError(retryAt);
        }
        throw new Error(`Ошибка запроса к Lichess (HTTP ${response.status}).`);
      }
      if (!body || typeof body.getReader !== 'function') throw new Error('Ответ Lichess не содержит поток данных.');
      reader = body.getReader();
      const result = await consume(() => Promise.race([reader.read(), deadline.promise]));
      complete = true;
      return result;
    } finally {
      deadline.clear();
      if (!complete) cancelBody(reader ?? body, controller.signal.reason);
      if (reader) {
        try { reader.releaseLock(); } catch {}
      }
    }
  }

  // Game pages and the profile share one queue, so a 429 pause covers both.
  function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  function requestPage({ since, until, max }) {
    const url = new URL(EXPORT_URL);
    url.search = new URLSearchParams({
      since, until, max, sort: 'dateAsc', ongoing: 'true', finished: 'true',
      moves: 'true', opening: 'true', clocks: 'false', evals: 'true', accuracy: 'true',
    }).toString();
    return request(url.href, 'application/x-ndjson', async read => {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const records = [];
      let wireBytes = 0;
      let pending = '';
      let lineNumber = 0;
      function parseLine(line) {
        lineNumber++;
        if (!line.trim()) return;
        if (records.length >= max) throw new Error(`Строка ${lineNumber}: превышен лимит партий.`);
        let record;
        try { record = JSON.parse(line); }
        catch { throw new Error(`Строка ${lineNumber}: некорректный JSON.`); }
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error(`Строка ${lineNumber}: ожидается объект партии.`);
        }
        records.push(record);
      }
      for (;;) {
        const { value, done } = await read();
        if (done) { pending += decoder.decode(); break; }
        wireBytes += value.byteLength;
        if (wireBytes > MAX_BYTES) throw new Error('Размер ответа Lichess превышает 8 MiB.');
        pending += decoder.decode(value, { stream: true });
        let start = 0;
        let end;
        while ((end = pending.indexOf('\n', start)) !== -1) {
          parseLine(pending.slice(start, end));
          start = end + 1;
        }
        pending = pending.slice(start);
      }
      if (pending) parseLine(pending);
      return { records, rows: records.length };
    });
  }

  async function requestPuzzleCount() {
    const json = await request(PROFILE_URL, 'application/json', async read => {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      let wireBytes = 0;
      for (;;) {
        const { value, done } = await read();
        if (done) return text + decoder.decode();
        wireBytes += value.byteLength;
        if (wireBytes > PROFILE_MAX_BYTES) throw new Error('Размер профиля Lichess превышает 1 MiB.');
        text += decoder.decode(value, { stream: true });
      }
    });
    let profile;
    try { profile = JSON.parse(json); } catch { throw noDataError(); }
    const games = profile?.perfs?.puzzle?.games;
    if (!Number.isSafeInteger(games) || games < 0) throw noDataError();
    return games;
  }

  return {
    async fetchGamesPage({ since, until, max = 200 } = {}) {
      if (!validTimestamp(since) || !validTimestamp(until) || since >= until) {
        throw new Error('Некорректный диапазон времени партий.');
      }
      if (!Number.isInteger(max) || max < 1 || max > 200) throw new Error('Некорректный лимит партий.');
      return enqueue(() => requestPage({ since, until, max }));
    },
    fetchPuzzleCount() {
      return enqueue(requestPuzzleCount);
    },
  };
}
