// JSON-haku yhdellä uudelleenyrityksellä.
import type { FetchJson } from './types';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
const retryable = (e: unknown) => (e instanceof HttpError ? e.status === 429 || e.status >= 500 : !isAbort(e));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Viiveet ennen uudelleenyrityksiä. Crossref hylkää pyynnön, jos samasta verkosta on toinen kesken. */
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Hakee osoitteen ja palauttaa JSON-rungon. 429-, 5xx- ja verkkovirheen jälkeen yritetään
 * uudelleen annetuilla viiveillä; muut virhekoodit heitetään heti HttpError-poikkeuksena.
 */
export function createFetchJson(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  retryDelaysMs: number[] = DEFAULT_RETRY_DELAYS_MS,
): FetchJson {
  const once = async (url: string, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status}: ${new URL(url).host}`);
    return response.json();
  };

  return async (url, signal) => {
    for (const wait of retryDelaysMs) {
      try {
        return await once(url, signal);
      } catch (error) {
        if (!retryable(error) || signal?.aborted) throw error;
        await delay(wait);
      }
    }
    return once(url, signal);
  };
}

/**
 * Jonottaa pyynnöt: yksi kerrallaan ja aloitusten välissä vähintään `minIntervalMs`.
 * Crossrefin julkinen rajapinta sallii yhden samanaikaisen pyynnön ja viisi pyyntöä
 * sekunnissa; ylityksestä tulee 429 ilman CORS-otsakkeita, minkä selain näyttää verkkovirheenä.
 * Keskeytetty pyyntö ohitetaan jonossa tekemättä verkkokutsua.
 */
export function serialized(fetchJson: FetchJson, minIntervalMs = 250): FetchJson {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;

  return (url, signal) => {
    const run = async (): Promise<unknown> => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await delay(wait);
      lastStart = Date.now();
      return fetchJson(url, signal);
    };
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
}
