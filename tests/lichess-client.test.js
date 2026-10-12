import test from 'node:test';
import assert from 'node:assert/strict';
import { createLichessClient } from '../extension/data/lichess-client.js';

const interval = { since: 0, until: 1000 };
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);
function response(chunks, options = {}, onCancel = () => {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? bytes(chunk) : chunk);
      controller.close();
    },
    cancel: onCancel,
  }), options);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('requests the public account with complete ascending export flags and no cookies or redirects', async () => {
  let request;
  const client = createLichessClient({ fetchImpl: async (url, options) => {
    request = { url: new URL(url), options };
    return response(['{"id":"one"}\n']);
  } });
  assert.deepEqual(await client.fetchGamesPage(interval), { records: [{ id: 'one' }], rows: 1 });
  assert.equal(request.url.origin, 'https://lichess.org');
  assert.equal(request.url.pathname, '/api/games/user/sebajun777');
  assert.deepEqual(Object.fromEntries(request.url.searchParams), {
    since: '0', until: '1000', max: '200', sort: 'dateAsc', ongoing: 'true',
    finished: 'true', moves: 'true', opening: 'true', clocks: 'false', evals: 'true', accuracy: 'true',
  });
  assert.equal(request.options.method, 'GET');
  assert.equal(new Headers(request.options.headers).get('Accept'), 'application/x-ndjson');
  assert.equal(new Headers(request.options.headers).get('Authorization'), null);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('decodes split UTF-8 and ignores keepalives while allowing a final row without LF', async () => {
  const encoded = bytes('\n  \n{"name":"Я"}\r\n\n{"id":"last"}');
  const split = encoded.indexOf(0xd0) + 1;
  const client = createLichessClient({ fetchImpl: async () => response([encoded.slice(0, split), encoded.slice(split)]) });
  assert.deepEqual(await client.fetchGamesPage({ ...interval, max: 2 }), { records: [{ name: 'Я' }, { id: 'last' }], rows: 2 });
});

test('accepts empty successful streams and blank keepalive streams', async () => {
  for (const chunks of [[], ['\n \r\n\t']]) {
    const client = createLichessClient({ fetchImpl: async () => response(chunks) });
    assert.deepEqual(await client.fetchGamesPage(interval), { records: [], rows: 0 });
  }
});

for (const changes of [
  { since: -1 }, { since: 0.5 }, { since: '0' }, { since: NaN }, { since: Infinity },
  { since: Number.MAX_SAFE_INTEGER + 1 }, { until: 8640000000000001 },
  { until: 0 }, { since: 1001 }, { max: 0 }, { max: 201 }, { max: 1.5 }, { max: '2' },
]) {
  test(`rejects invalid request ${JSON.stringify(changes)} without fetching`, async () => {
    let requests = 0;
    const client = createLichessClient({ fetchImpl: async () => { requests++; return response([]); } });
    await assert.rejects(client.fetchGamesPage({ ...interval, ...changes }));
    assert.equal(requests, 0);
  });
}

test('rejects invalid timeout options before using the network', () => {
  for (const timeoutMs of [0, -1, Infinity, NaN, '10']) {
    assert.throws(() => createLichessClient({ timeoutMs }));
  }
});

test('rejects invalid clock results rather than creating a retry date', async () => {
  for (const clock of [NaN, Infinity, -1, '1000', 8640000000000001]) {
    let requests = 0;
    const client = createLichessClient({ now: () => clock, fetchImpl: async () => { requests++; return response([], { status: 429 }); } });
    await assert.rejects(client.fetchGamesPage(interval));
    assert.equal(requests, 0);
  }
});

test('malformed JSON reports the physical source line and cancels the stream', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(bytes('\n{"id":"good"}\n \n{\n')); },
    cancel() { cancelled = true; },
  });
  const client = createLichessClient({ fetchImpl: async () => new Response(stream) });
  await assert.rejects(client.fetchGamesPage(interval), /строк.*4/i);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

for (const invalid of ['null', '[]', 'true', '1', '"string"']) {
  test(`rejects a nonobject NDJSON row ${invalid} instead of a partial page`, async () => {
    const client = createLichessClient({ fetchImpl: async () => response(['{}\n\n' + invalid]) });
    await assert.rejects(client.fetchGamesPage(interval), /строк.*3/i);
  });
}

test('the row limit counts all nonblank records', async () => {
  const client = createLichessClient({ fetchImpl: async () => response(['\n{}\n\n{}\n']) });
  await assert.rejects(client.fetchGamesPage({ ...interval, max: 1 }), /строк.*5|лимит|количеств/i);
});

test('rejects invalid UTF-8 even after an otherwise valid row', async () => {
  for (const tail of [new Uint8Array([0xff]), new Uint8Array([0xd0])]) {
    const client = createLichessClient({ fetchImpl: async () => response(['{}\n', tail]) });
    await assert.rejects(client.fetchGamesPage(interval));
  }
});

test('enforces the 8 MiB wire-byte limit including multibyte text and blank lines', async () => {
  const limit = 8 * 1024 * 1024;
  const client = createLichessClient({ fetchImpl: async () => response(['{}\n', ' '.repeat(limit - 3)]) });
  assert.deepEqual(await client.fetchGamesPage(interval), { records: [{}], rows: 1 });
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes('{}\n'));
      controller.enqueue(bytes(' '.repeat(limit - 4) + 'Я'));
    },
    cancel() { cancelled = true; },
  });
  const tooLarge = createLichessClient({ fetchImpl: async () => new Response(stream) });
  await assert.rejects(tooLarge.fetchGamesPage(interval), /8|размер|MiB/i);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('body errors reject the entire page and release its reader', async () => {
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(bytes('{}\n')); },
    pull(controller) { controller.error(new Error('body interrupted')); },
  });
  const client = createLichessClient({ fetchImpl: async () => new Response(stream) });
  await assert.rejects(client.fetchGamesPage(interval), /body interrupted/);
  assert.equal(stream.locked, false);
});

test('a missing stream rejects without falling back to text', async () => {
  const client = createLichessClient({ fetchImpl: async () => new Response(null) });
  await assert.rejects(client.fetchGamesPage(interval), /поток|тело/i);
});

test('HTTP errors cancel the body and explain the failure in Russian', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const client = createLichessClient({ fetchImpl: async () => new Response(stream, { status: 503 }) });
  await assert.rejects(client.fetchGamesPage(interval), error => /503/.test(error.message) && /[а-я]/i.test(error.message));
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

for (const [header, retryAt] of [[null, 61000], ['invalid', 61000], ['1', 61000], ['120', 121000], ['Tue, 06 Oct 2026 12:03:00 GMT', Date.parse('2026-10-06T12:03:00Z')]]) {
  test(`429 uses Retry-After ${header} and rejects during cooldown without retrying`, async () => {
    let requests = 0;
    let clock = header?.includes('GMT') ? Date.parse('2026-10-06T12:00:00Z') : 1000;
    const client = createLichessClient({ now: () => clock, fetchImpl: async () => {
      requests++;
      return requests === 1 ? response([], { status: 429, headers: header === null ? {} : { 'Retry-After': header } }) : response([]);
    } });
    await assert.rejects(client.fetchGamesPage(interval), error => error.retryAt === retryAt);
    clock = retryAt - 1;
    await assert.rejects(client.fetchGamesPage(interval), error => error.retryAt === retryAt);
    assert.equal(requests, 1);
    clock = retryAt;
    assert.deepEqual(await client.fetchGamesPage(interval), { records: [], rows: 0 });
    assert.equal(requests, 2);
  });
}

test('queued calls observe a 429 cooldown before another fetch starts', async () => {
  const firstFetch = deferred();
  const started = deferred();
  let requests = 0;
  const client = createLichessClient({ now: () => 1000, fetchImpl: async () => {
    requests++;
    started.resolve();
    return firstFetch.promise;
  } });
  const first = assert.rejects(client.fetchGamesPage(interval), error => error.retryAt === 61000);
  await started.promise;
  const second = assert.rejects(client.fetchGamesPage(interval), error => error.retryAt === 61000);
  firstFetch.resolve(response([], { status: 429 }));
  await Promise.all([first, second]);
  assert.equal(requests, 1);
});

test('serializes requests through complete response body reading', async () => {
  let controller;
  let requests = 0;
  const started = deferred();
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const client = createLichessClient({ fetchImpl: async () => {
    requests++;
    started.resolve();
    return requests === 1 ? new Response(stream) : response(['{"id":"two"}']);
  } });
  const first = client.fetchGamesPage(interval);
  await started.promise;
  const second = client.fetchGamesPage(interval);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  controller.enqueue(bytes('{"id":"one"}\n'));
  controller.close();
  assert.deepEqual(await first, { records: [{ id: 'one' }], rows: 1 });
  assert.deepEqual(await second, { records: [{ id: 'two' }], rows: 1 });
  assert.equal(stream.locked, false);
});

test('timeout aborts a hanging body, cancels it, and permits the next queued request', async () => {
  let cancelled = false;
  let firstSignal;
  let requests = 0;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(bytes('{}\n')); },
    cancel() { cancelled = true; },
  });
  const client = createLichessClient({ timeoutMs: 20, fetchImpl: async (url, options) => {
    requests++;
    if (requests === 1) { firstSignal = options.signal; return new Response(stream); }
    return response([]);
  } });
  const first = assert.rejects(client.fetchGamesPage(interval), /время|тайм|ожидан/i);
  const second = client.fetchGamesPage(interval);
  await first;
  assert.equal(firstSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
  assert.deepEqual(await second, { records: [], rows: 0 });
});

test('timeout also terminates a fetch that ignores its abort signal', async () => {
  let signal;
  const client = createLichessClient({ timeoutMs: 20, fetchImpl: (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(client.fetchGamesPage(interval), /время|тайм|ожидан/i);
  assert.equal(signal.aborted, true);
});

test('network rejection is not retried and does not block later explicit requests', async () => {
  let requests = 0;
  const client = createLichessClient({ fetchImpl: async () => {
    requests++;
    if (requests === 1) throw new Error('network unavailable');
    return response([]);
  } });
  await assert.rejects(client.fetchGamesPage(interval), /network unavailable/);
  assert.deepEqual(await client.fetchGamesPage(interval), { records: [], rows: 0 });
  assert.equal(requests, 2);
});

test('reads the public puzzle counter without cookies, token or redirects', async () => {
  let request;
  const client = createLichessClient({ fetchImpl: async (url, options) => {
    request = { url: new URL(url), options };
    return response(['{"id":"sebajun777","perfs":{"puzzle":{"games":894,"rating":1861}}}']);
  } });
  assert.equal(await client.fetchPuzzleCount(), 894);
  assert.equal(request.url.href, 'https://lichess.org/api/user/sebajun777');
  assert.equal(request.options.method, 'GET');
  assert.equal(new Headers(request.options.headers).get('Accept'), 'application/json');
  assert.equal(new Headers(request.options.headers).get('Authorization'), null);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal instanceof AbortSignal);
});

for (const [name, body] of [
  ['missing puzzle perf', '{"perfs":{}}'],
  ['negative counter', '{"perfs":{"puzzle":{"games":-1}}}'],
  ['fractional counter', '{"perfs":{"puzzle":{"games":1.5}}}'],
  ['string counter', '{"perfs":{"puzzle":{"games":"894"}}}'],
  ['invalid JSON', '{"perfs":'],
]) {
  test(`puzzle counter reports no-data for ${name}`, async () => {
    const client = createLichessClient({ fetchImpl: async () => response([body]) });
    await assert.rejects(client.fetchPuzzleCount(), error => error.code === 'no-data');
  });
}

test('puzzle counter shares the 429 pause with game pages', async () => {
  let requests = 0;
  const client = createLichessClient({ now: () => 1000, fetchImpl: async () => {
    requests++;
    return response([], { status: 429, headers: { 'Retry-After': '120' } });
  } });
  await assert.rejects(client.fetchPuzzleCount(), error => error.retryAt === 121000);
  await assert.rejects(client.fetchGamesPage(interval), error => error.retryAt === 121000);
  assert.equal(requests, 1);
});

test('puzzle counter times out and aborts the request', async () => {
  let signal;
  const client = createLichessClient({ timeoutMs: 5, fetchImpl: (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(client.fetchPuzzleCount(), /Истекло время/);
  assert.equal(signal.aborted, true);
});

test('puzzle counter rejects profile bodies above 1 MiB', async () => {
  const client = createLichessClient({ fetchImpl: async () => response([new Uint8Array(1024 * 1024 + 1)]) });
  await assert.rejects(client.fetchPuzzleCount(), /1 MiB/);
});
