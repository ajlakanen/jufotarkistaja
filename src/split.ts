// Jakaa PDF:stä kopioidun lähdeluettelon yksittäisiksi lähteiksi.
import { repairSpacedDoi } from './parse';

const HEADING = /^(lähteet|lähdeluettelo|kirjallisuus|references|reference list|bibliography|works cited)$/i;
const PAGE_NUMBER = /^\d{1,4}$/;
// Lähteen alku: "Sukunimi, E." / "Sukunimi, Etunimi" / "Organisaatio (LYH). (2020" / "Organisaatio. 2008" / "Tekijä. “Otsikko".
// Sukunimen edessä voi olla pienellä kirjoitettu etuliite (van, von, de…).
const PARTICLES = '(?:(?:van|von|de|del|della|di|da|dos|du|la|le|af|ten|ter|den|der)\\s+)*';
const ORG_ABBR = '(?:\\s\\(\\p{L}{2,12}\\))?';
const AUTHOR_START = new RegExp(
  `^${PARTICLES}\\p{Lu}[^\\d(]{1,80}?(?:,\\s+\\p{Lu}(?:\\.|\\p{Ll})|${ORG_ABBR}\\.\\s+\\(?\\d{4}|${ORG_ABBR}\\.\\s+\\((?:n\\.d|s\\.a)|\\.\\s+["“”])`,
  'u',
);
const CHAPTER_LINE = /^(?:In|Teoksessa)\s/;
const YEAR_ONLY = /^(?:1[5-9]\d\d|20\d\d)$/;
const YEAR = '(?:1[5-9]\\d\\d|20\\d\\d)[a-z]?';
// Sama tekijä kuin edellisessä lähteessä: Chicago latoo tekijän paikalle pitkän viivan ("———. 2013.").
// PDF piirtää viivan usein grafiikkana, jolloin kopioituun tekstiin jää pelkkä piste (". 2013.").
// Osuma on viivaosuus, joka voi olla tyhjä.
const DASH = '(?:[—–―⸺⸻_-]\\s*)';
const SAME_AUTHOR = new RegExp(
  `^(?:(?:[⸺⸻]\\s*|${DASH}{2,})(?=[.,]\\s)|${DASH}?(?=\\.\\s+(?:${YEAR}\\.\\s|["“”])))`,
);
/** Lähteen alun tekijät tekijä–vuosi-muodossa: "Virtanen, Anna ja Lauri Niemi. 2019." */
const LEADING_AUTHORS = new RegExp(`^([^"“”()]{1,300}?)\\.\\s+(?:${YEAR}|n\\.d|s\\.a)\\.`);
const LIST_MARKER = /^(?:\[\d{1,3}\]|\(?\d{1,3}[.)]|[•·▪◦*–-])\s+/;

/**
 * Näyttääkö rivi uuden lähteen alulta. Jatkorivit kuten "Thousand Oaks, CA: Sage.",
 * "Computers, Environment and Urban Systems, 80, 101–110." ja "In R. Valli, J. Aaltola (Eds.)…"
 * eivät kelpaa: tekijäosassa ei ole muita lukuja kuin vuosiluku.
 */
function startsReference(line: string): boolean {
  if (SAME_AUTHOR.test(line)) return true;
  if (CHAPTER_LINE.test(line) || !AUTHOR_START.test(line)) return false;
  const firstNumber = line.match(/\d+/);
  if (!firstNumber || YEAR_ONLY.test(firstNumber[0])) return true;
  // Muu luku kelpaa vain, jos tekijäosa on jo päättynyt ennen sitä (koko lähde yhdellä rivillä).
  return /\.\s|["“]/.test(line.slice(0, firstNumber.index));
}
// Saman tekijän saman vuoden lähteissä vuoden perässä on kirjain ("2020a").
const HAS_YEAR = /\b(1[5-9]\d\d|20\d\d)[a-z]?\b|n\.d\.|s\.a\./;
const TERMINAL = /[.!?”")\]]$/;
/** Lähde päättyy osoitteeseen (APA:ssa osoitteen perässä ei ole pistettä). */
const URL_END = /(?:^|\s)(?:https?:\/\/|doi\.org\/|www\.)\S+$/;
/** Rivin lopussa on osoite, joka voi jatkua seuraavalla rivillä. */
const URL_TAIL = /(?:^|\s)https?(?::\S*)?$/;

const ended = (cur: string) => TERMINAL.test(cur) || URL_END.test(cur);
const complete = (cur: string) => HAS_YEAR.test(cur) && ended(cur);
const continuesUrl = (cur: string, line: string) =>
  URL_TAIL.test(cur) && (!/\s/.test(line) || line.startsWith('//'));

/** Korvaa saman tekijän viivan (tai siitä jääneen tyhjän) edellisen lähteen tekijöillä. */
function withRepeatedAuthors(line: string, previous: string): string {
  const dashes = SAME_AUTHOR.exec(line);
  const authors = dashes && LEADING_AUTHORS.exec(previous)?.[1];
  return dashes && authors ? authors + line.slice(dashes[0].length) : line;
}

function join(cur: string, line: string): string {
  if (continuesUrl(cur, line)) return cur + line;
  // Tavutus: "re-" + "view" → "review"
  if (/\p{L}-$/u.test(cur) && /^\p{Ll}/u.test(line)) return cur.slice(0, -1) + line;
  // Aito tavuviiva: "978-3-031-" + "22298-6", "Holloway-" + "Attaway"
  if (/\S-$/.test(cur) && /^[\p{Lu}\d]/u.test(line)) return cur + line;
  return cur + ' ' + line;
}

export function splitReferences(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/(https?)[ \t]+:/g, '$1:')
    .split('\n');

  const refs: string[] = [];
  let cur: string | null = null;
  let afterBlank = true;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) {
      afterBlank = true;
      continue;
    }
    if (PAGE_NUMBER.test(line) || HEADING.test(line)) continue;
    // "[1] Braun, V. …" tai "• Braun, V. …": merkki pois, jos sen jälkeen alkaa lähde.
    const unmarked = line.replace(LIST_MARKER, '');
    if (unmarked !== line && startsReference(unmarked)) line = unmarked;

    if (cur === null) {
      cur = line;
    } else if (
      (ended(cur) && startsReference(line) && (afterBlank || HAS_YEAR.test(cur))) ||
      (complete(cur) && afterBlank && !continuesUrl(cur, line))
    ) {
      refs.push(repairSpacedDoi(cur));
      cur = withRepeatedAuthors(line, cur);
    } else {
      cur = join(cur, line);
    }
    afterBlank = false;
  }
  if (cur !== null) refs.push(repairSpacedDoi(cur));
  return refs;
}
