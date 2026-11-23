import { HttpError, createFetchJson, serialized } from './http';

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Väärennetty fetch, joka palauttaa annetut vastaukset järjestyksessä. */
function fakeFetch(...steps: Array<Response | Error>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const step = steps[calls.length - 1];
    if (step === undefined) throw new Error('liian monta kutsua');
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { impl, calls };
}

it('palauttaa JSONin', async () => {
  const f = fakeFetch(json(200, { a: 1 }));
  expect(await createFetchJson(f.impl, [0])('https://x.test/a')).toEqual({ a: 1 });
  expect(f.calls).toEqual(['https://x.test/a']);
});

it('yrittää kerran uudelleen 429:n jälkeen', async () => {
  const f = fakeFetch(json(429), json(200, [1]));
  expect(await createFetchJson(f.impl, [0])('https://x.test/a')).toEqual([1]);
  expect(f.calls).toHaveLength(2);
});

it('yrittää kerran uudelleen verkkovirheen jälkeen', async () => {
  const f = fakeFetch(new TypeError('Failed to fetch'), json(200, 'ok'));
  expect(await createFetchJson(f.impl, [0])('https://x.test/a')).toBe('ok');
  expect(f.calls).toHaveLength(2);
});

it('toinen epäonnistuminen heittää HttpErrorin', async () => {
  const f = fakeFetch(json(503), json(503));
  const error = await createFetchJson(f.impl, [0])('https://x.test/a').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(503);
  expect(f.calls).toHaveLength(2);
});

it('toistuva verkkovirhe heitetään eteenpäin', async () => {
  const f = fakeFetch(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
  await expect(createFetchJson(f.impl, [0])('https://x.test/a')).rejects.toThrow('Failed to fetch');
  expect(f.calls).toHaveLength(2);
});

it('yrittää uudelleen niin monta kertaa kuin viiveitä on annettu', async () => {
  const ok = fakeFetch(json(429), new TypeError('Failed to fetch'), json(503), json(200, 'ok'));
  expect(await createFetchJson(ok.impl, [0, 0, 0])('https://x.test/a')).toBe('ok');
  expect(ok.calls).toHaveLength(4);

  const never = fakeFetch(json(429), json(429), json(429), json(429), json(200));
  await expect(createFetchJson(never.impl, [0, 0, 0])('https://x.test/a')).rejects.toBeInstanceOf(HttpError);
  expect(never.calls).toHaveLength(4);
});

it('oletuksena kolme uudelleenyritystä kasvavalla viiveellä', async () => {
  vi.useFakeTimers();
  try {
    const f = fakeFetch(json(429), json(429), json(429), json(200, 'ok'));
    const result = createFetchJson(f.impl)('https://x.test/a');
    await vi.advanceTimersByTimeAsync(999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe('ok');
    expect(f.calls).toHaveLength(4);
  } finally {
    vi.useRealTimers();
  }
});

it('404 ei yritä uudelleen', async () => {
  const f = fakeFetch(json(404));
  const error = await createFetchJson(f.impl, [0])('https://x.test/a').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(404);
  expect(f.calls).toHaveLength(1);
});

it('keskeytystä ei yritetä uudelleen', async () => {
  const f = fakeFetch(new DOMException('Aborted', 'AbortError'), json(200));
  await expect(createFetchJson(f.impl, [0])('https://x.test/a')).rejects.toThrow('Aborted');
  expect(f.calls).toHaveLength(1);
});

describe('serialized', () => {
  afterEach(() => vi.useRealTimers());

  /** fetchJson, jonka kutsut ratkaistaan käsin. */
  function manual() {
    const started: Array<{ url: string; finish: (v?: unknown) => void; fail: (e: Error) => void }> = [];
    const fetchJson = (url: string) =>
      new Promise<unknown>((finish, fail) => started.push({ url, finish: (v) => finish(v ?? url), fail }));
    return { fetchJson, started };
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('päästää läpi yhden pyynnön kerrallaan, saapumisjärjestyksessä', async () => {
    vi.useFakeTimers();
    const m = manual();
    const queued = serialized(m.fetchJson, 0);
    const results = [queued('a'), queued('b'), queued('c')];
    await flush();
    expect(m.started.map((s) => s.url)).toEqual(['a']);
    m.started[0]!.finish();
    await flush();
    expect(m.started.map((s) => s.url)).toEqual(['a', 'b']);
    m.started[1]!.finish();
    await flush();
    m.started[2]!.finish();
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c']);
  });

  it('pitää pyyntöjen aloitusten välissä vähimmäisvälin', async () => {
    vi.useFakeTimers();
    const m = manual();
    const queued = serialized(m.fetchJson, 250);
    void queued('a');
    void queued('b');
    await flush();
    m.started[0]!.finish();
    await vi.advanceTimersByTimeAsync(249);
    expect(m.started).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.started).toHaveLength(2);
  });

  it('epäonnistunut pyyntö ei pysäytä jonoa', async () => {
    vi.useFakeTimers();
    const m = manual();
    const queued = serialized(m.fetchJson, 0);
    const first = queued('a').catch((e: Error) => e.message);
    const second = queued('b');
    await flush();
    m.started[0]!.fail(new Error('rikki'));
    await flush();
    m.started[1]!.finish();
    expect(await first).toBe('rikki');
    expect(await second).toBe('b');
  });

  it('keskeytetty pyyntö ohitetaan jonossa ilman verkkokutsua', async () => {
    vi.useFakeTimers();
    const m = manual();
    const queued = serialized(m.fetchJson, 0);
    const controller = new AbortController();
    void queued('a');
    const aborted = queued('b', controller.signal).catch((e: Error) => e.name);
    const third = queued('c');
    controller.abort();
    await flush();
    m.started[0]!.finish();
    await flush();
    expect(await aborted).toBe('AbortError');
    expect(m.started.map((s) => s.url)).toEqual(['a', 'c']);
    m.started[1]!.finish();
    expect(await third).toBe('c');
  });
});
