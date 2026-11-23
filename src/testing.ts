// Testiapurit: kanavien rakentaminen ja väärennetyt rajapinta-asiakkaat.
import type { CrossrefApi, CrossrefWork, JufoApi, JufoChannel, Level, LevelReading } from './types';

export const L = (level: Level): LevelReading => ({ kind: 'level', level });
export const NONE: LevelReading = { kind: 'none' };
export const UNRATED: LevelReading = { kind: 'unrated' };

/** Tasohistoria, jossa sama lukema vuosille from–to. */
export function years(reading: LevelReading, from = 2012, to = 2026): Record<number, LevelReading> {
  const history: Record<number, LevelReading> = {};
  for (let y = from; y <= to; y++) history[y] = reading;
  return history;
}

export function channel(over: Partial<JufoChannel> = {}): JufoChannel {
  const level = over.level ?? L(1);
  return {
    jufoId: 1,
    title: 'Testikanava',
    otherTitles: [],
    type: 'series',
    abbreviation: null,
    issns: [],
    level,
    history: years(level),
    ...over,
  };
}

export function work(over: Partial<CrossrefWork> = {}): CrossrefWork {
  return {
    doi: '10.1234/testi',
    title: 'Testiotsikko joka on riittävän pitkä',
    type: 'journal-article',
    containerTitles: [],
    issns: [],
    publisher: null,
    year: null,
    eventName: null,
    ...over,
  };
}

export function fakeJufo(over: Partial<JufoApi> = {}): JufoApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async byIssn(issn) {
      calls.push(`byIssn:${issn}`);
      return over.byIssn ? over.byIssn(issn) : null;
    },
    async byName(name, type) {
      calls.push(`byName:${name}:${type}`);
      return over.byName ? over.byName(name, type) : [];
    },
    async byAbbr(abbr) {
      calls.push(`byAbbr:${abbr}`);
      return over.byAbbr ? over.byAbbr(abbr) : [];
    },
  };
}

export function fakeCrossref(over: Partial<CrossrefApi> = {}): CrossrefApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async byDoi(doi) {
      calls.push(`byDoi:${doi}`);
      return over.byDoi ? over.byDoi(doi) : null;
    },
    async search(raw) {
      calls.push('search');
      return over.search ? over.search(raw) : null;
    },
  };
}
