/** Pienaakkoset, tarkkeet ja välimerkit pois, välit tiivistettynä. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const COMPANY_WORDS = new Set([
  'publications', 'publication', 'publishing', 'publishers', 'publisher', 'press', 'sons',
  'ltd', 'limited', 'inc', 'llc', 'gmbh', 'verlag', 'oy', 'ab', 'kustannus', 'kustannusosakeyhtio', 'books',
]);

/** Kanavan nimi vertailua varten: kuten normalizeText, mutta ilman yhtiö- ja kustantamosanoja. */
export function normalizeChannelName(s: string): string {
  const full = normalizeText(s);
  const words = full.split(' ').filter((w) => !COMPANY_WORDS.has(w));
  while (words[words.length - 1] === 'and') words.pop();
  // "The MIT Press" on Jufossa "Mit press": nimen alun artikkeli ei kuulu nimeen.
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ') || full;
}

/** "The MIT Press" → "MIT Press" */
export function withoutLeadingArticle(name: string): string {
  return name.replace(/^the\s+/i, '');
}

/** Löytyykö teoksen otsikko viitteen tekstistä. Alle 10 merkin otsikot osuvat liian helposti. */
export function titleInReference(title: string, raw: string): boolean {
  const t = normalizeText(title);
  return t.length >= 10 && normalizeText(raw).includes(t);
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Purkaa HTML-entiteetit: Crossrefin nimissä on "Languages &amp; Applications". Tuntematon entiteetti säilyy. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (entity: string, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = dec ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
