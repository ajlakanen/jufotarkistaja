// Lähteiden käsittely rinnakkaisuusrajalla sekä hakujen välimuisti yhden tarkistuksen ajaksi.
import type { CheckResult, CrossrefApi, JufoApi } from './types';

export interface RunOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * Käsittelee lähteet enintään `concurrency` kerrallaan ja raportoi jokaisen tuloksen
 * heti sen valmistuttua. Keskeytyksen jälkeen uusia ei aloiteta eikä käynnissä
 * olleiden tuloksia enää raportoida.
 */
export async function runChecks<T extends { raw: string }>(
  refs: T[],
  resolve: (ref: T) => Promise<CheckResult>,
  onResult: (index: number, result: CheckResult) => void,
  opts: RunOptions = {},
): Promise<void> {
  const { concurrency = 3, signal } = opts;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < refs.length && !signal?.aborted) {
      const index = next++;
      const ref = refs[index]!;
      let result: CheckResult;
      try {
        result = await resolve(ref);
      } catch (error) {
        result = { status: 'error', raw: ref.raw, message: error instanceof Error ? error.message : String(error) };
      }
      if (signal?.aborted) return;
      onResult(index, result);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
}

/** Muistaa lupaukset avaimella; hylätty lupaus poistetaan, jotta uusi yritys tekee haun uudelleen. */
function memoize<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const cache = new Map<string, Promise<R>>();
  return (...args: A) => {
    const key = JSON.stringify(args);
    const hit = cache.get(key);
    if (hit) return hit;
    const promise = fn(...args);
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    return promise;
  };
}

export function cachedJufo(api: JufoApi): JufoApi {
  return {
    byIssn: memoize((issn) => api.byIssn(issn)),
    byName: memoize((name, type) => api.byName(name, type)),
    byAbbr: memoize((abbr) => api.byAbbr(abbr)),
  };
}

export function cachedCrossref(api: CrossrefApi): CrossrefApi {
  return {
    byDoi: memoize((doi) => api.byDoi(doi)),
    search: memoize((raw) => api.search(raw)),
  };
}
