import { cachedCrossref, cachedJufo, runChecks } from './runner';
import { channel, fakeCrossref, fakeJufo, work } from './testing';
import type { CheckResult } from './types';

const result = (raw: string): CheckResult => ({ status: 'error', raw, message: 'testi' });
type Ref = { raw: string };
const refsOf = (...raws: string[]): Ref[] => raws.map((raw) => ({ raw }));
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** resolve-funktio, jonka lupaukset ratkaistaan käsin. */
function manualResolver() {
  const pending: Array<{ raw: string; finish: () => void }> = [];
  let active = 0;
  let peak = 0;
  const resolve = ({ raw }: Ref) =>
    new Promise<CheckResult>((done) => {
      active++;
      peak = Math.max(peak, active);
      pending.push({ raw, finish: () => { active--; done(result(raw)); } });
    });
  return { resolve, pending, peak: () => peak };
}

it('käsittelee kaikki ja välittää oikean indeksin', async () => {
  const refs = refsOf('a', 'b', 'c', 'd', 'e');
  const given: Ref[] = [];
  const seen: Array<[number, string]> = [];
  await runChecks(refs, async (ref) => { given.push(ref); return result(ref.raw); }, (i, r) => seen.push([i, r.raw]));
  expect(given).toEqual(refs);
  expect(seen.sort((x, y) => x[0] - y[0])).toEqual([[0, 'a'], [1, 'b'], [2, 'c'], [3, 'd'], [4, 'e']]);
});

it('tyhjä lista ei tee mitään', async () => {
  const onResult = vi.fn();
  await runChecks([] as Ref[], async (ref) => result(ref.raw), onResult);
  expect(onResult).not.toHaveBeenCalled();
});

it('enintään 3 kerrallaan', async () => {
  const refs = Array.from({ length: 10 }, (_, i) => ({ raw: `ref${i}` }));
  const m = manualResolver();
  const onResult = vi.fn();
  const run = runChecks(refs, m.resolve, onResult);
  let finished = 0;
  while (finished < refs.length) {
    await tick();
    expect(m.pending.length - finished).toBeLessThanOrEqual(3);
    m.pending[finished++]!.finish();
  }
  await run;
  expect(m.peak()).toBe(3);
  expect(onResult).toHaveBeenCalledTimes(10);
});

it('keskeytys: uusia ei aloiteta eikä myöhässä valmistuvia raportoida', async () => {
  const refs = Array.from({ length: 6 }, (_, i) => ({ raw: `ref${i}` }));
  const m = manualResolver();
  const onResult = vi.fn();
  const controller = new AbortController();
  const run = runChecks(refs, m.resolve, onResult, { signal: controller.signal });
  await tick();
  expect(m.pending).toHaveLength(3);
  controller.abort();
  m.pending.forEach((p) => p.finish());
  await run;
  expect(onResult).not.toHaveBeenCalled();
  expect(m.pending).toHaveLength(3);
});

it('resolve-funktion poikkeus raportoidaan virheenä eikä pysäytä ajoa', async () => {
  const seen: CheckResult[] = [];
  await runChecks(refsOf('a', 'b'), async ({ raw }) => {
    if (raw === 'a') throw new Error('rikki');
    return result(raw);
  }, (_i, r) => seen.push(r));
  expect(seen).toContainEqual({ status: 'error', raw: 'a', message: 'rikki' });
  expect(seen).toHaveLength(2);
});

it('cachedJufo: sama haku tehdään kerran', async () => {
  const sust = channel({ jufoId: 71524 });
  const inner = fakeJufo({ byIssn: async () => sust });
  const api = cachedJufo(inner);
  expect(await api.byIssn('2071-1050')).toBe(sust);
  expect(await api.byIssn('2071-1050')).toBe(sust);
  await api.byName('A', 'series');
  await api.byName('A', 'series');
  await api.byName('A', 'conference');
  await api.byAbbr('CHI');
  await api.byAbbr('CHI');
  expect(inner.calls).toEqual(['byIssn:2071-1050', 'byName:A:series', 'byName:A:conference', 'byAbbr:CHI']);
});

it('cachedJufo: hylätty lupaus ei jää välimuistiin', async () => {
  let attempt = 0;
  const inner = fakeJufo({ byIssn: async () => { if (attempt++ === 0) throw new Error('verkko'); return channel(); } });
  const api = cachedJufo(inner);
  await expect(api.byIssn('2071-1050')).rejects.toThrow('verkko');
  expect(await api.byIssn('2071-1050')).not.toBeNull();
  expect(inner.calls).toHaveLength(2);
});

it('cachedCrossref: byDoi ja search muistetaan avaimella', async () => {
  const inner = fakeCrossref({ byDoi: async (doi) => work({ doi }), search: async () => work() });
  const api = cachedCrossref(inner);
  expect((await api.byDoi('10.1/a'))?.doi).toBe('10.1/a');
  await api.byDoi('10.1/a');
  await api.byDoi('10.1/b');
  await api.search('viite yksi');
  await api.search('viite yksi');
  await api.search('viite kaksi');
  expect(inner.calls).toEqual(['byDoi:10.1/a', 'byDoi:10.1/b', 'search', 'search']);
});
