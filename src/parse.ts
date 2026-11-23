// Jäsentää yhden lähteen (splitReferences-funktion tuottama yksirivinen teksti).
// Tukee APA-muotoa sekä Chicagon tekijä–vuosi- ja alaviite–bibliografia-muotoja,
// myös suomeksi lokalisoituna (ja, Teoksessa, toimittanut, numero, kuukaudet).
import type { KindHint, ParsedReference } from './types';

const MONTHS = new Set([
  'tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]);

// Preprint tai aineisto: tunniste kertoo tyypin varmasti.
const PREPRINT_TEXT = /(?<!\p{L})arxiv:|arxiv\.org/iu;
export const UNCLASSIFIABLE_DOI = /^10\.(5281\/zenodo|48550\/)/i;
// Raportti tai opinnäyte: kokonainen sana otsikon ulkopuolella ("synthesis" tai kirjan nimi
// "Toiminnallinen opinnäytetyö" ei kelpaa), ja vain kun DOI:ta tai ISSN:ää ei ole –
// muuten Crossref tai Jufo ratkaisee tyypin.
export const REPORT_OR_THESIS =
  /(?<!\p{L})(?:technical report|tech\. rep\.|working paper|\p{L}*raportti|väitöskirja|pro gradu|opinnäytetyö|dissertation|diss\.|thesis)(?!\p{L})/iu;
// Hakupäivä ("Viitattu 3.5.2024.", "Retrieved May 3, 2024, from") ei kuulu lähteen rakenteeseen.
const ACCESS_NOTE =
  /(?:^|(?<=[.?!”"]\s))(?:Retrieved|Accessed|Viitattu|Haettu|Luettu|Katsottu)\b.{0,30}?\b(?:19|20)\d{2}\b[^]*$/iu;
const AVAILABLE_AT = /\s*(?:Saatavissa|Saatavilla|Available(?:\s+(?:at|from))?)\s*:?\s*$/i;
// Lehti: nimi päättyy ennen vuosikertaa, sivuja tai sulkeissa olevaa kuukautta tai paikkaa.
const JOURNAL = /^(.+?)(?:,\s*\d|\s+\d+\s*[(,:]|\s+\([^)]*\)\s*(?::|\d))/;
const CONFERENCE_WORDS = /proceedings|conference|symposium|workshop|konferenssi/i;

const APA_YEAR = /\((?:(\d{4})[a-z]?(?:,[^)]*)?|n\.d\.|s\.a\.|in press|painossa)\)\.?\s+/i;
const CHICAGO_AUTHOR_DATE_YEAR = /\.\s+(\d{4})[a-z]?\.\s+/;
const OPEN_QUOTE = /^["“]/;

/** PDF hajottaa DOI:n joskus muotoon "10 . 1234 / 5678 . 9012". */
function repairSpacedDoi(text: string): string {
  return text.replace(
    /\b10\s*\.\s*(\d{4,9})\s*\/\s*(\S+(?:\s+\.\s+\S+)*)/,
    (_m, prefix: string, suffix: string) => `10.${prefix}/${suffix.replace(/\s+/g, '')}`,
  );
}

export function findDoi(text: string): string | null {
  const m = text.match(/\b10\.\d{4,9}\/[^\s"<>]+/i);
  return m ? m[0].replace(/[.,;)]+$/, '') : null;
}

function findIssn(text: string): string | null {
  const m = text.match(/\bISSN:?\s*(\d{4})-?(\d{3}[\dXx])\b/i);
  return m ? `${m[1]}-${m[2]!.toUpperCase()}` : null;
}

export function validYear(s: string | undefined): number | null {
  if (!s) return null;
  const y = Number(s);
  return y >= 1500 && y <= 2100 ? y : null;
}

/** Jakaa tekstin jaksoihin pisteen, kysymys- tai huutomerkin kohdalta, kun ei olla sulkeiden sisällä. */
function sentences(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '.' || ch === '?' || ch === '!')) {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        const keep = ch === '.' ? i : i + 1;
        const piece = text.slice(start, keep).trim();
        if (piece) out.push({ text: piece, start, end: i + 1 });
        start = i + 1;
      }
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push({ text: tail, start, end: text.length });
  return out;
}

function stripTrailingParens(text: string): { text: string; parens: string[] } {
  const parens: string[] = [];
  let t = text.trim();
  for (;;) {
    const m = t.match(/\s*(?:\(([^()]*)\)|\[([^[\]]*)\])$/);
    if (!m) break;
    parens.unshift(m[1] ?? m[2] ?? '');
    t = t.slice(0, m.index).trim();
  }
  return { text: t, parens };
}

const isMonth = (segment: string) => MONTHS.has(segment.replace(/[()]/g, '').trim().toLowerCase());
const isUrl = (segment: string) => /^(https?:|www\.|doi:)/i.test(segment);

/** "Helsinki: Tammi, 2009" → "Tammi" */
function publisherFrom(segment: string): string | null {
  let p = segment.replace(/,\s*\d{4}$/, '').trim();
  const colon = p.lastIndexOf(': ');
  if (colon >= 0) p = p.slice(colon + 2).trim();
  return p || null;
}

/** Konferenssin lyhenne: sulkeissa "ICSE" tai "CHI '19", omana jaksonaan vain vuoden kanssa ("CHI ’19"). */
export function acronymIn(text: string, yearRequired: boolean): string | null {
  const m = text.match(/^([A-Z]{2,10})(\s*['’]\s*\d{2}|\s+\d{4})?$/);
  return m && (m[2] || !yearRequired) ? m[1]! : null;
}

interface Body {
  container: string | null;
  publisher: string | null;
  conferenceAbbr: string | null;
  kindHint: KindHint;
  year: number | null;
}

/** Tulkitsee otsikon jälkeisen osan: lehti, kirjan luku, konferenssijulkaisu tai kirja. */
function parseBody(after: string): Body {
  const body: Body = { container: null, publisher: null, conferenceAbbr: null, kindHint: null, year: null };
  const text = after.trim();
  if (!text) return body;

  const chapter = text.match(/^(?:In|Teoksessa)\s+(.*)$/s);
  if (chapter) {
    const parts = sentences(chapter[1]!).map((s) => s.text).filter((s) => !isMonth(s) && !isUrl(s));
    if (CONFERENCE_WORDS.test(chapter[1]!)) {
      body.kindHint = 'conference';
      const first = (parts.shift() ?? '').replace(/,\s*\d+\s*[–-]\s*\d+$/, '');
      const { text: name, parens } = stripTrailingParens(first);
      body.container = name || null;
      for (const p of parens) body.conferenceAbbr ??= acronymIn(p.trim(), false);
      const rest = parts.filter((p) => {
        const abbr = acronymIn(p, true);
        if (abbr) body.conferenceAbbr ??= abbr;
        return !abbr;
      });
      const last = rest[rest.length - 1];
      body.publisher = last ? publisherFrom(last) : null;
    } else {
      body.kindHint = 'book';
      body.publisher = parts.length > 1 ? publisherFrom(parts[parts.length - 1]!) : null;
    }
    return body;
  }

  // Chicago alaviite–bibliografia, kirja: "Helsinki: Tammi, 2009."
  const publisherYear = text.match(/^(?:[^:.]+:\s*)?([^:,.]+),\s*(\d{4})\.?$/);
  if (publisherYear && validYear(publisherYear[2])) {
    body.kindHint = 'book';
    body.publisher = publisherYear[1]!.trim();
    body.year = validYear(publisherYear[2]);
    return body;
  }

  const journal = text.match(JOURNAL);
  if (journal && journal[1]!.length <= 150 && !/https?:/i.test(journal[1]!)) {
    body.kindHint = 'article';
    body.container = journal[1]!.trim();
    body.year = validYear(text.match(/\((\d{4})\)\s*:/)?.[1]);
    return body;
  }

  const parts = sentences(text).map((s) => s.text).filter((s) => !isMonth(s) && !isUrl(s));
  const last = parts[parts.length - 1];
  if (last) {
    body.kindHint = 'book';
    body.publisher = publisherFrom(last);
  }
  return body;
}

/**
 * Erottaa otsikon ja sen jälkeisen osan tekstistä, joka alkaa otsikolla.
 * `extras` on otsikon perässä sulkeissa tai hakasulkeissa ollut lisätieto
 * ("15. uud. p.", "Pro gradu -tutkielma, Helsingin yliopisto").
 */
function splitTitle(rest: string): { title: string | null; after: string; extras: string[] } {
  const text = rest.trim();
  if (!text) return { title: null, after: '', extras: [] };

  if (OPEN_QUOTE.test(text)) {
    const close = text[0] === '“' ? text.indexOf('”', 1) : text.indexOf('"', 1);
    if (close > 0) {
      const title = text.slice(1, close).replace(/[.,]$/, '').trim();
      const after = text.slice(close + 1).replace(/^[.,]?\s*/, '');
      return { title: title || null, after, extras: [] };
    }
  }

  const parts = sentences(text);
  if (parts.length === 0) return { title: null, after: '', extras: [] };

  // Otsikossa voi olla useita virkkeitä ("Mitä on tekoäly? Johdatus aiheeseen.") tai lyhenteitä ("U.S."):
  // jos loppuosa näyttää lehdeltä, otsikko on kaikki sitä ennen. Muuten otsikko on ensimmäinen virke.
  // Kirjan luvussa ("In …", "Teoksessa …") otsikko päättyy siihen, mistä teoksen tiedot alkavat.
  let bodyStart = parts[0]!.end;
  const chapter = parts.findIndex((part, k) => k >= 1 && /^(?:In|Teoksessa)\s/.test(part.text));
  if (chapter >= 1) {
    bodyStart = parts[chapter]!.start;
  } else {
    for (let k = parts.length - 1; k >= 1; k--) {
      if (JOURNAL.test(text.slice(parts[k]!.start).trim())) {
        bodyStart = parts[k]!.start;
        break;
      }
    }
  }
  const { text: title, parens } = stripTrailingParens(text.slice(0, bodyStart).trim().replace(/\.$/, ''));
  return { title: title || null, after: text.slice(bodyStart), extras: parens };
}

function parse(raw: string): ParsedReference {
  const text = repairSpacedDoi(raw);
  const doi = findDoi(text);
  const issn = findIssn(text);

  // Tunnisteet ja osoitteet eivät kuulu lähteen rakenteeseen.
  const cleaned = text
    .replace(/\bIS[SB]N:?\s*[\dXx-]+\.?/gi, '')
    .replace(/\s*(?:https?:\/\/\S+|\bdoi:\s*\S+|\b10\.\d{4,9}\/\S+)\s*$/i, '')
    .replace(ACCESS_NOTE, '')
    .replace(AVAILABLE_AT, '')
    .trim();

  let year: number | null = null;
  let rest: string | null = null;

  const apa = cleaned.match(APA_YEAR);
  const authorDate = cleaned.match(CHICAGO_AUTHOR_DATE_YEAR);
  const authorDateYear = validYear(authorDate?.[1]);

  if (apa && (!authorDateYear || apa.index! < authorDate!.index!)) {
    year = validYear(apa[1]);
    rest = cleaned.slice(apa.index! + apa[0].length);
  } else if (authorDate && authorDateYear) {
    year = authorDateYear;
    rest = cleaned.slice(authorDate.index! + authorDate[0].length);
  } else {
    // Chicago alaviite–bibliografia: tekijät päättyvät ensimmäiseen pisteeseen sanan jälkeen.
    const authorsEnd = cleaned.match(/\p{Ll}{2}\.\s+/u);
    if (authorsEnd) rest = cleaned.slice(authorsEnd.index! + authorsEnd[0].length);
  }

  let title: string | null = null;
  let body: Body = { container: null, publisher: null, conferenceAbbr: null, kindHint: null, year: null };
  let outsideTitle = '';
  if (rest !== null) {
    const split = splitTitle(rest);
    title = split.title;
    body = parseBody(split.after);
    year ??= body.year;
    outsideTitle = [split.after, ...split.extras].join(' ');
  }

  const unclassifiable =
    PREPRINT_TEXT.test(raw) ||
    (doi !== null && UNCLASSIFIABLE_DOI.test(doi)) ||
    (doi === null && issn === null && REPORT_OR_THESIS.test(outsideTitle));

  return {
    raw,
    doi,
    issn,
    year,
    title,
    container: body.container,
    publisher: body.publisher,
    conferenceAbbr: body.conferenceAbbr,
    kindHint: unclassifiable ? 'unclassifiable' : body.kindHint,
  };
}

export function parseReference(raw: string): ParsedReference {
  try {
    return parse(raw);
  } catch {
    return {
      raw, doi: null, issn: null, year: null, title: null,
      container: null, publisher: null, conferenceAbbr: null, kindHint: null,
    };
  }
}
