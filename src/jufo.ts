// Julkaisufoorumin REST-rajapinnan v2.1 asiakas.
// Rajapinta palauttaa asiaan liittymättömän listan, jos parametri on väärä,
// joten jokainen tulos varmistetaan täällä ennen käyttöä.
import { JufoFormatError, readCurrentLevel, readHistoryLevel } from './levels';
import { normalizeChannelName } from './normalize';
import type { ChannelType, FetchJson, JufoApi, JufoChannel, LevelReading } from './types';

export const JUFO_BASE = 'https://jufo-rest.csc.fi/v2.1';

const TYPES: Record<string, ChannelType> = {
  Series: 'series',
  'Book publisher': 'bookpublisher',
  Conference: 'conference',
};

/** "1687725x" → "1687-725X"; null, jos merkkijono ei ole ISSN. */
export function normalizeIssn(s: string): string | null {
  const m = s.replace(/[\s-]/g, '').match(/^(\d{4})(\d{3}[\dXx])$/);
  return m ? `${m[1]}-${m[2]!.toUpperCase()}` : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optionalString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseChannel(raw: unknown): JufoChannel {
  if (!isRecord(raw)) throw new JufoFormatError('Kanavatietue ei ole olio');

  const { jufo_id: jufoId, title } = raw;
  if (typeof jufoId !== 'number' || typeof title !== 'string') {
    throw new JufoFormatError('Kanavatietueesta puuttuu jufo_id tai title');
  }

  const type = isRecord(raw.type) && typeof raw.type.id === 'string' ? TYPES[raw.type.id] : undefined;
  if (!type) throw new JufoFormatError(`Tuntematon kanavatyyppi kanavalla ${jufoId}`);

  if (!isRecord(raw.level_history)) throw new JufoFormatError(`level_history ei ole olio kanavalla ${jufoId}`);
  const history: Record<number, LevelReading> = {};
  for (const [year, value] of Object.entries(raw.level_history)) {
    if (!/^\d{4}$/.test(year)) throw new JufoFormatError(`Odottamaton vuosi tasohistoriassa: ${year}`);
    history[Number(year)] = readHistoryLevel(value);
  }

  const issns = [raw.issn_print, raw.issn_electronic, raw.issnl]
    .map((v) => (typeof v === 'string' ? normalizeIssn(v) : null))
    .filter((v): v is string => v !== null);

  return {
    jufoId,
    title,
    otherTitles: (optionalString(raw.title_other) ?? '').split(';').map((t) => t.trim()).filter(Boolean),
    type,
    abbreviation: optionalString(raw.abbreviation),
    issns: [...new Set(issns)],
    level: readCurrentLevel(raw.level),
    history,
  };
}

export function createJufoApi(fetchJson: FetchJson): JufoApi {
  const search = async (params: Record<string, string>): Promise<JufoChannel[]> => {
    const query = new URLSearchParams({ ...params, _size: '100' });
    const body = await fetchJson(`${JUFO_BASE}/search?${query}`);
    if (!Array.isArray(body)) throw new JufoFormatError('Julkaisufoorumin haku ei palauttanut listaa');
    return body.map(parseChannel);
  };

  return {
    async byIssn(issn) {
      const wanted = normalizeIssn(issn);
      if (!wanted) return null;
      const channels = await search({ issn: wanted });
      return channels.find((c) => c.issns.includes(wanted)) ?? null;
    },
    byName: (name, type) => search({ name, type }),
    byAbbr: (abbr) => search({ abbr, type: 'conference' }),
  };
}

/**
 * Nimihaun tuloksista kelpaa vain kanava, jonka nimi tai rinnakkaisnimi on
 * normalisoituna täsmälleen haettu nimi. Jos täsmääviä on useita, osuma on epäselvä.
 */
export function matchByName(name: string, channels: JufoChannel[]): JufoChannel | null {
  const wanted = normalizeChannelName(name);
  if (!wanted) return null;
  const matches = channels.filter((c) => [c.title, ...c.otherTitles].some((t) => normalizeChannelName(t) === wanted));
  return matches.length === 1 ? matches[0]! : null;
}
