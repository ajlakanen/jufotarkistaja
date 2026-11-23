// Crossref-asiakas: teoksen tunnistus DOI:lla tai koko viitteellä.
// Kutsuihin ei liitetä sähköpostiosoitetta eikä muuta käyttäjätietoa.
import { HttpError } from './http';
import { normalizeText, titleInReference } from './normalize';
import type { CrossrefApi, CrossrefWork, FetchJson, ParsedReference } from './types';

const CROSSREF_WORKS = 'https://api.crossref.org/works';
const SELECT = 'DOI,title,container-title,ISSN,publisher,type,issued,event';

export type WorkKind = 'article' | 'book' | 'conference' | 'unclassifiable' | 'unknown';

const KINDS: Record<string, WorkKind> = {
  'journal-article': 'article',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'book-chapter': 'book',
  'book-section': 'book',
  'book-part': 'book',
  'proceedings-article': 'conference',
  proceedings: 'conference',
  report: 'unclassifiable',
  dissertation: 'unclassifiable',
  'posted-content': 'unclassifiable',
  dataset: 'unclassifiable',
};

export function workKind(crossrefType: string): WorkKind {
  return KINDS[crossrefType] ?? 'unknown';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Crossrefin teostietue; null, jos DOI tai otsikko puuttuu. */
export function parseWork(raw: unknown): CrossrefWork | null {
  if (!isRecord(raw)) return null;
  const title = strings(raw.title)[0];
  if (typeof raw.DOI !== 'string' || !title) return null;

  const dateParts = isRecord(raw.issued) ? raw.issued['date-parts'] : undefined;
  const year = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0][0] : undefined;
  const eventName = isRecord(raw.event) ? raw.event.name : undefined;

  return {
    doi: raw.DOI,
    title,
    type: typeof raw.type === 'string' ? raw.type : '',
    containerTitles: strings(raw['container-title']),
    issns: strings(raw.ISSN),
    publisher: typeof raw.publisher === 'string' ? raw.publisher : null,
    year: typeof year === 'number' ? year : null,
    eventName: typeof eventName === 'string' ? eventName : null,
  };
}

export function createCrossrefApi(fetchJson: FetchJson): CrossrefApi {
  return {
    async byDoi(doi) {
      try {
        const body = await fetchJson(`${CROSSREF_WORKS}/${encodeURIComponent(doi)}`);
        return isRecord(body) ? parseWork(body.message) : null;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    },
    async search(raw) {
      const query = new URLSearchParams({ 'query.bibliographic': raw, rows: '1', select: SELECT });
      const body = await fetchJson(`${CROSSREF_WORKS}?${query}`);
      const items = isRecord(body) && isRecord(body.message) ? body.message.items : undefined;
      return Array.isArray(items) ? parseWork(items[0]) : null;
    },
  };
}

/**
 * Crossrefin viitehaku palauttaa aina jonkin osuman. Osuma hyväksytään vain, jos sen
 * otsikko löytyy viitteen tekstistä ja julkaisuvuosi täsmää vuoden tarkkuudella.
 */
export function isVerifiedMatch(work: CrossrefWork, parsed: ParsedReference): boolean {
  if (!titlesMatch(work.title, parsed)) return false;
  if (kindsContradict(workKind(work.type), parsed.kindHint)) return false;
  if (work.year === null || parsed.year === null) return true;
  return Math.abs(work.year - parsed.year) <= 1;
}

const MIN_TITLE_LENGTH = 10;
const MIN_PREFIX_WORDS = 4;

/**
 * Otsikon pitää olla sama kuin viitteestä jäsennetty otsikko. Toinen saa olla toisen alku
 * (alaotsikko puuttuu), jos lyhyemmässä on vähintään neljä sanaa: "Research Design" tai
 * "Introduction" ei riitä tunnistamaan teosta.
 */
function titlesMatch(workTitle: string, parsed: ParsedReference): boolean {
  const found = normalizeText(workTitle);
  if (found.length < MIN_TITLE_LENGTH) return false;
  if (parsed.title === null) {
    return found.split(' ').length >= MIN_PREFIX_WORDS && titleInReference(workTitle, parsed.raw);
  }
  const wanted = normalizeText(parsed.title);
  if (found === wanted) return true;
  const [shorter, longer] = found.length < wanted.length ? [found, wanted] : [wanted, found];
  return shorter.split(' ').length >= MIN_PREFIX_WORDS && longer.startsWith(`${shorter} `);
}

/** Viite näyttää kirjalta mutta osuma on lehtiartikkeli (arvostelu), tai päinvastoin; tai osuma on preprint. */
function kindsContradict(found: WorkKind, hint: ParsedReference['kindHint']): boolean {
  if (hint === null || hint === 'unclassifiable') return false;
  if (found === 'unclassifiable') return true;
  return (hint === 'book' && found === 'article') || (hint === 'article' && found === 'book');
}

/** "CHI '19: Human Factors in Computing Systems" → "CHI"; "… on Software Engineering (ICSE)" → "ICSE". */
export function conferenceAbbrFromEvent(eventName: string | null): string | null {
  if (!eventName) return null;
  const leading = eventName.match(/^([A-Z]{2,10})\s*(?:['’]\s*\d{2}|\d{4})\s*:/);
  if (leading) return leading[1]!;
  const trailing = eventName.match(/\(([A-Z]{2,10})\)\s*$/);
  return trailing ? trailing[1]! : null;
}
