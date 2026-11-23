// Lukee BibTeX-kirjaston (.bib) lähteiksi. Tietueen kentät viedään suoraan samaan rakenteeseen,
// jonka tekstijäsennin (parse.ts) tuottaa viitetekstistä, joten julkaisupaikkaa ei tarvitse arvata.
// Näytettävä rivi kootaan kentistä; siihen eivät kuulu tiivistelmät, asiasanat tai muistiinpanot.
import { normalizeIssn } from './jufo';
import { REPORT_OR_THESIS, UNCLASSIFIABLE_DOI, acronymIn, findDoi, validYear } from './parse';
import type { KindHint, ParsedReference } from './types';

const ENTRY_START = /@[ \t]*([A-Za-z]+)\s*\{/g;
const ENTRY_AT_LINE_START = /^[ \t]*@[A-Za-z]+[ \t]*\{/m;
/** Uuden tietueen alku rivin alussa: sulkematta jäänyt arvo päättyy viimeistään tähän. */
const NEXT_ENTRY = /\n[ \t]*@[A-Za-z]+[ \t]*\{/g;
const FIELD_NAME = /[^\s=,{}"#@]+/y;
const BARE_VALUE = /[^\s,#{}"]+/y;
const ENTRY_KEY = /[^\s,}]*/y;

export function isBibtex(text: string): boolean {
  return ENTRY_AT_LINE_START.test(text);
}

interface Entry {
  type: string;                    // pienaakkosin, ilman @-merkkiä
  key: string;
  fields: Map<string, string>;     // nimet pienaakkosin; arvot ilman uloimpia erottimia, LaTeX-merkinnät mukana
}

/**
 * Tietueet järjestyksessä. Tietueiden ulkopuolinen teksti ohitetaan, kuten BibTeXissä.
 * Virheellinen tietue päättyy siihen, mihin sen luku pysähtyy, ja luku jatkuu seuraavasta.
 */
function readEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  const macros = new Map<string, string>();
  let pos = 0;

  const skipSpace = (): void => {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  };
  const take = (pattern: RegExp): string => {
    pattern.lastIndex = pos;
    const found = pattern.exec(text)?.[0] ?? '';
    pos += found.length;
    return found;
  };

  /** Aaltosulkeissa tai lainausmerkeissä oleva arvo; `pos` on avaavan merkin kohdalla. */
  const delimited = (): string => {
    const quoted = text[pos] === '"';
    const start = ++pos;
    NEXT_ENTRY.lastIndex = start;
    const limit = NEXT_ENTRY.exec(text)?.index ?? text.length;
    let depth = 0;
    for (; pos < limit; pos++) {
      const ch = text[pos];
      if (ch === '\\' && text[pos + 1] === '"') pos++;
      else if (ch === '{') depth++;
      else if (ch === '}' && depth > 0) depth--;
      else if (ch === (quoted ? '"' : '}') && depth === 0) break;
    }
    const value = text.slice(start, pos);
    if (pos < limit) pos++;
    return value;
  };

  /** Kentän arvo: #-merkillä yhdistettyjä osia, joista kukin on erottimissa, luku tai makron nimi. */
  const value = (): string => {
    let out = '';
    for (;;) {
      skipSpace();
      if (text[pos] === '{' || text[pos] === '"') {
        out += delimited();
      } else {
        const bare = take(BARE_VALUE);
        if (!bare) break;
        out += macros.get(bare.toLowerCase()) ?? bare;
      }
      skipSpace();
      if (text[pos] !== '#') break;
      pos++;
    }
    return out;
  };

  /** Kentät sulkevaan aaltosulkeeseen asti. Sama kenttä kahdesti: ensimmäinen jää voimaan. */
  const fields = (): Map<string, string> => {
    const out = new Map<string, string>();
    for (;;) {
      while (pos < text.length && /[\s,]/.test(text[pos]!)) pos++;
      if (text[pos] === '}') {
        pos++;
        break;
      }
      const name = take(FIELD_NAME).toLowerCase();
      skipSpace();
      if (!name || text[pos] !== '=') break;
      pos++;
      const v = value();
      if (!out.has(name)) out.set(name, v);
    }
    return out;
  };

  for (;;) {
    ENTRY_START.lastIndex = pos;
    const start = ENTRY_START.exec(text);
    if (!start) break;
    pos = start.index + start[0].length;
    const type = start[1]!.toLowerCase();
    if (type === 'comment' || type === 'preamble') {
      pos--;
      delimited();
    } else if (type === 'string') {
      for (const [name, v] of fields()) macros.set(name, v);
    } else {
      skipSpace();
      const key = take(ENTRY_KEY);
      entries.push({ type, key, fields: fields() });
    }
  }
  return entries;
}

const ACCENTS: Record<string, string> = {
  '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307',
  c: '\u0327', v: '\u030C', H: '\u030B', r: '\u030A', u: '\u0306', k: '\u0328', d: '\u0323', b: '\u0331',
};
const LETTERS: Record<string, string> = {
  aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ss: 'ß', i: 'i', j: 'j',
};
// \"a, \"{a}, {\"a}, \v{r}, \'{\i}
const ACCENTED = /\\(["'`^~=.]|[cvHrukdb](?![A-Za-z]))(?:\s*\{\s*\\?([A-Za-z])\s*\}|\s*\\?([A-Za-z]))/g;
const SPECIAL_LETTER = /\\(aa|AA|ae|AE|oe|OE|ss|o|O|l|L|i|j)(?![A-Za-z])\s*/g;

/** LaTeX-merkinnät tekstiksi: tarkkeet, erikoiskirjaimet, komennot, ryhmittelysulkeet, viivat ja lainausmerkit. */
function texToText(value: string): string {
  return value
    .replace(ACCENTED, (_m, accent: string, braced?: string, plain?: string) =>
      `${braced ?? plain}${ACCENTS[accent]}`.normalize('NFC'))
    .replace(SPECIAL_LETTER, (_m, name: string) => LETTERS[name]!)
    .replace(/\\\\|\\[-/]/g, ' ')
    .replace(/\\[A-Za-z]+\*?\s*/g, '')
    .replace(/(?<!\\)[{}$]/g, '')
    .replace(/\\([&%$#_{} ])/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tekijät erotetaan sanalla and; aaltosulkeissa oleva and kuuluu nimeen ("{Barnes and Noble}"). */
function splitNames(value: string): string[] {
  const flat = value.replace(/\s+/g, ' ');
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === '{') depth++;
    else if (flat[i] === '}') depth--;
    else if (depth === 0 && flat.slice(i, i + 5).toLowerCase() === ' and ') {
      names.push(flat.slice(start, i));
      start = i + 5;
    }
  }
  names.push(flat.slice(start));
  return names.map(texToText).filter(Boolean);
}

const MAX_AUTHORS_SHOWN = 3;

function authorList(names: string[]): string {
  const andOthers = names[names.length - 1]?.toLowerCase() === 'others';
  const real = andOthers ? names.slice(0, -1) : names;
  const shown = real.slice(0, MAX_AUTHORS_SHOWN);
  const separator = shown.some((n) => n.includes(',')) ? '; ' : ', ';
  return shown.join(separator) + (andOthers || real.length > shown.length ? ' ym.' : '');
}

const KINDS: Record<string, KindHint> = {
  article: 'article',
  book: 'book', booklet: 'book', inbook: 'book', incollection: 'book', collection: 'book',
  inproceedings: 'conference', conference: 'conference', proceedings: 'conference',
};
const REPORT_OR_THESIS_TYPES = new Set([
  'techreport', 'report', 'phdthesis', 'mastersthesis', 'thesis', 'unpublished', 'dataset',
]);

function toReference({ type, key, fields }: Entry): ParsedReference {
  const text = (name: string): string | null => texToText(fields.get(name) ?? '') || null;
  const identifier = (name: string): string => (fields.get(name) ?? '').replace(/\\([_%#&])/g, '$1').replace(/[{}]/g, '');

  const doi = findDoi(identifier('doi')) ?? findDoi(identifier('url'));
  const issn = normalizeIssn(identifier('issn').match(/\d{4}-?\d{3}[\dXx]/)?.[0] ?? '');
  const year = validYear(text('year')?.match(/\d{4}/)?.[0]) ?? validYear(text('date')?.match(/\d{4}/)?.[0]);
  const title = text('title');
  const journal = text('journal') ?? text('journaltitle');
  const booktitle = text('booktitle');
  const container = journal ?? booktitle;
  const publisher = text('publisher');

  let conferenceAbbr = acronymIn(text('series') ?? '', true);
  for (const m of (booktitle ?? '').matchAll(/\(([^()]*)\)/g)) conferenceAbbr ??= acronymIn(m[1]!.trim(), false);

  // Tietuetyyppi on vain vihje: kirjastoissa se on usein väärin, ja DOI:n kautta Crossrefin tyyppi ratkaisee.
  // Zenodon ja arXivin DOI kertoo tyypin varmasti. Muuten arXiv-merkintä tekee lähteestä preprintin vain,
  // kun julkaisupaikkaa ei ole (julkaistun artikkelin tietueessa voi olla eprint-kenttä), ja raportti- tai
  // opinnäytetyyppi ratkaisee vain, kun tunnistetta ei ole.
  const identified = doi !== null || issn !== null;
  const arxiv = /arxiv/i.test(['archiveprefix', 'eprinttype', 'eprint', 'url', 'howpublished', 'note'].map(identifier).join(' '));
  const unclassifiable =
    (doi !== null && UNCLASSIFIABLE_DOI.test(doi)) ||
    /^arxiv\b/i.test(journal ?? '') ||
    (!identified && !container && arxiv) ||
    (!identified && REPORT_OR_THESIS_TYPES.has(type)) ||
    (!identified && !container && !publisher &&
      REPORT_OR_THESIS.test([title, text('type'), text('note'), text('howpublished')].join(' ')));

  const authors = authorList(splitNames(fields.get('author') ?? fields.get('editor') ?? ''));
  const volume = text('volume');
  const number = text('number');
  const pages = text('pages')?.replace(/(\d)\s*[-–—]+\s*(\d)/g, '$1–$2');
  const where = container
    ? [container, `${volume ?? ''}${number ? `(${number})` : ''}`, pages].filter(Boolean).join(', ')
    : null;
  const sentences = [
    [authors, year ? `(${year})` : ''].filter(Boolean).join(' '),
    title,
    where,
    journal ? null : publisher,
  ].filter((s): s is string => !!s).map((s) => (/[.?!]$/.test(s) ? s : `${s}.`));
  if (doi) sentences.push(`https://doi.org/${doi}`);

  return {
    key,
    raw: sentences.join(' ') || `@${type}{${key}}`,
    doi,
    issn,
    year,
    title,
    container,
    publisher,
    conferenceAbbr,
    kindHint: unclassifiable ? 'unclassifiable' : (KINDS[type] ?? null),
  };
}

export function parseBibtex(text: string): ParsedReference[] {
  return readEntries(text).map(toReference);
}
