// Yhden lähteen käsittely: viite → teos (Crossref) → julkaisukanava (Jufo) → arvio.
import { conferenceAbbrFromEvent, isVerifiedMatch, workKind } from './crossref';
import { matchByName, normalizeIssn } from './jufo';
import { assess } from './levels';
import { normalizeChannelName, normalizeText, withoutLeadingArticle } from './normalize';
import { parseReference } from './parse';
import type {
  ChannelType, CheckResult, Confidence, CrossrefApi, CrossrefWork, JufoApi, JufoChannel, Matched, ParsedReference,
  ResultNote,
} from './types';

export interface ResolveDeps {
  jufo: JufoApi;
  crossref: CrossrefApi;
}

const SKIPPED_IN_ACRONYM = new Set(['inc', 'ltd', 'llc', 'gmbh', 'oy', 'ab']);
const MAX_CANDIDATES = 3;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

/**
 * Hakusanat, joilla kustantajaa haetaan Jufosta. Jufon nimihaku ei hae rinnakkaisnimistä,
 * ja suurten kustantajien päänimi on usein lyhenne ("ACM"), joten koko nimen lisäksi
 * kokeillaan nimeä ilman yhtiösanoja, ensimmäistä sanaa ja alkukirjainlyhennettä.
 * Osumaksi kelpaa silti vain kanava, jonka nimi täsmää alkuperäiseen nimeen.
 */
export function publisherSearchTerms(name: string): string[] {
  const bare = withoutLeadingArticle(name);
  const terms = [name, bare];

  const stripped = normalizeChannelName(name);
  if (stripped !== normalizeText(bare)) terms.push(stripped);

  const words = bare.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const first = words[0];
  if (words.length >= 2 && first && first.length >= 4) terms.push(first);

  const initials = words
    .filter((w) => /^\p{Lu}/u.test(w) && !SKIPPED_IN_ACRONYM.has(w.toLowerCase()))
    .map((w) => w[0]!);
  if (initials.length >= 3) terms.push(initials.join(''));

  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Proceedings of the 2019 CHI Conference on X (CHI '19): Subtitle" → "CHI Conference on X" */
function conferenceName(container: string): string {
  return container
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/:.*$/, '')
    .replace(/^proceedings? of (the )?/i, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b\d+(st|nd|rd|th)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nimen ydinosa sanasta Conference/Symposium/Workshop/Congress loppuun. */
function conferenceCore(name: string): string | null {
  const m = name.match(/\b(?:conference|symposium|workshop|congress)\w*\b.*$/i);
  return m ? m[0] : null;
}

async function resolve(parsed: ParsedReference, { jufo, crossref }: ResolveDeps): Promise<CheckResult> {
  const raw = parsed.raw;
  const notClassified: CheckResult = {
    status: 'not-in-jufo', raw, reason: 'type-not-classified', searchedName: null, candidates: [],
  };
  if (parsed.kindHint === 'unclassifiable') return notClassified;

  let pubYear = parsed.year;
  const single = (channel: JufoChannel, confidence: Confidence, note: ResultNote): CheckResult => {
    const assessment = assess(channel, pubYear);
    return { status: assessment.below ? 'below' : 'ok', raw, channel, confidence, note, pubYear, assessment };
  };

  // Oikotie: viitteeseen kirjoitettu ISSN. Konferenssijulkaisulle haetaan ensin konferenssi.
  const triedIssns = new Set<string>();
  if (parsed.issn && parsed.kindHint !== 'conference') {
    triedIssns.add(parsed.issn);
    const channel = await jufo.byIssn(parsed.issn);
    if (channel) return single(channel, 'varma', parsed.kindHint === 'book' ? 'series' : null);
  }

  // Teos: DOI:lla, muuten koko viitteellä; viitehaun osuma kelpaa vain varmistettuna.
  let work: CrossrefWork | null = parsed.doi ? await crossref.byDoi(parsed.doi) : null;
  if (!work) {
    const found = await crossref.search(raw);
    if (found && isVerifiedMatch(found, parsed)) work = found;
  }
  pubYear = parsed.year ?? work?.year ?? null;

  const publisherNames = unique([parsed.publisher, work?.publisher ?? null].filter((n): n is string => !!n));
  const container = work?.containerTitles[0] ?? parsed.container;

  let kind = work ? workKind(work.type) : 'unknown';
  if (kind === 'unknown') {
    kind = parsed.kindHint ?? (work?.containerTitles[0] ? 'article' : publisherNames.length > 0 ? 'book' : 'unknown');
  }
  if (kind === 'unclassifiable') return notClassified;

  const searchedNames: string[] = [];
  const candidates: JufoChannel[] = [];

  const searchByName = async (name: string, type: ChannelType, collect = true): Promise<JufoChannel[]> => {
    const results = await jufo.byName(name, type);
    if (collect) candidates.push(...results);
    return results;
  };

  const findByIssn = async (): Promise<JufoChannel | null> => {
    const issns = unique([...(work?.issns ?? []), parsed.issn ?? '']
      .map(normalizeIssn)
      .filter((i): i is string => i !== null && !triedIssns.has(i)));
    for (const issn of issns) {
      triedIssns.add(issn);
      const channel = await jufo.byIssn(issn);
      if (channel) return channel;
    }
    return null;
  };

  const findPublisher = async (): Promise<JufoChannel | null> => {
    for (const name of publisherNames) {
      searchedNames.push(name);
      const fullNameTerms = new Set([name, withoutLeadingArticle(name), normalizeChannelName(name)]);
      for (const term of publisherSearchTerms(name)) {
        const results = await searchByName(term, 'bookpublisher', fullNameTerms.has(term));
        const match = matchByName(name, results);
        if (match) return match;
      }
    }
    return null;
  };

  const findConference = async (): Promise<JufoChannel | null> => {
    const name = container ? conferenceName(container) : '';
    if (!name) return null;
    searchedNames.push(name);
    const exact = matchByName(name, await searchByName(name, 'conference'));
    if (exact) return exact;

    const abbr = parsed.conferenceAbbr ?? conferenceAbbrFromEvent(work?.eventName ?? null);
    if (!abbr) return null;
    const byAbbr = await jufo.byAbbr(abbr);
    candidates.push(...byAbbr);
    const core = conferenceCore(name);
    if (!core || core === name) return null;
    const byCore = await searchByName(core, 'conference');
    const common = byAbbr.filter((a) => byCore.some((c) => c.jufoId === a.jufoId));
    return common.length === 1 ? common[0]! : null;
  };

  const notFound = (): CheckResult => {
    if (searchedNames.length === 0) {
      return { status: 'not-in-jufo', raw, reason: 'no-channel-identified', searchedName: null, candidates: [] };
    }
    const seen = new Set<number>();
    const distinct = candidates.filter((c) => !seen.has(c.jufoId) && seen.add(c.jufoId));
    return {
      status: 'not-in-jufo', raw, reason: 'channel-not-found',
      searchedName: searchedNames[0]!, candidates: distinct.slice(0, MAX_CANDIDATES),
    };
  };

  /** Kirjat, kirjan luvut ja konferenssijulkaisut, joiden konferenssia ei ole Jufossa. */
  const seriesAndPublisher = async (publisherOnlyNote: ResultNote): Promise<CheckResult> => {
    const seriesChannel = await findByIssn();
    const publisherChannel = await findPublisher();
    const matched = (channel: JufoChannel, confidence: Confidence): Matched =>
      ({ channel, confidence, assessment: assess(channel, pubYear) });

    if (seriesChannel && publisherChannel) {
      const series = matched(seriesChannel, 'varma');
      const publisher = matched(publisherChannel, 'tarkista');
      if (series.assessment.below !== publisher.assessment.below) {
        return { status: 'conflict', raw, pubYear, series, publisher };
      }
    }
    if (seriesChannel) {
      const below = assess(seriesChannel, pubYear).below;
      const unchecked = below && !publisherChannel && publisherNames.length > 0;
      return single(seriesChannel, 'varma', unchecked ? 'series-publisher-not-found' : 'series');
    }
    if (publisherChannel) return single(publisherChannel, 'tarkista', publisherOnlyNote);
    return notFound();
  };

  if (kind === 'article') {
    const byIssn = await findByIssn();
    if (byIssn) return single(byIssn, 'varma', null);
    if (container) {
      searchedNames.push(container);
      // Jufon nimessä ei aina ole alun artikkelia ("The Journal of X" → "Journal of X").
      for (const term of unique([container, withoutLeadingArticle(container)])) {
        const match = matchByName(container, await searchByName(term, 'series'));
        if (match) return single(match, 'tarkista', null);
      }
    }
    return notFound();
  }

  if (kind === 'conference') {
    const conference = await findConference();
    if (conference) return single(conference, 'tarkista', null);
    return seriesAndPublisher('conference-publisher');
  }

  if (kind === 'book') return seriesAndPublisher(null);

  return notFound();
}

/**
 * Valmiiksi jäsennetty lähde: liitetyn luettelon viite tai BibTeX-tietue.
 * Ei koskaan hylkää lupausta: rajapinta- ja muotovirheet palautetaan tilana "error".
 */
export async function resolveParsed(parsed: ParsedReference, deps: ResolveDeps): Promise<CheckResult> {
  try {
    return await resolve(parsed, deps);
  } catch (error) {
    return { status: 'error', raw: parsed.raw, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Yksi viite tekstinä. */
export function resolveReference(raw: string, deps: ResolveDeps): Promise<CheckResult> {
  return resolveParsed(parseReference(raw), deps);
}
