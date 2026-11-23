// Tulosten piirto DOM:iin. Kaikki käyttäjän ja rajapintojen teksti viedään
// sivulle textContentilla, ei koskaan HTML:nä.
import { FIRST_HISTORY_YEAR, formatAtPublication, formatCurrent } from './levels';
import { findDoi } from './parse';
import type { Assessment, ChannelType, CheckResult, Confidence, JufoChannel, ParsedReference, ResultNote } from './types';

export const JUFO_PORTAL = 'https://jfp.csc.fi/jufoportaali?Jufo_ID=';

/** Lähteestä näytetään viite ja BibTeX-kirjastosta tulleelle myös tietueen avain. */
export type ShownReference = Pick<ParsedReference, 'raw' | 'key'>;

export interface RunState {
  refs: ShownReference[];
  results: Array<CheckResult | undefined>;
  running: boolean;
}

export interface Summary {
  total: number;
  done: number;
  below: number;
  conflict: number;
  notInJufo: number;
  ok: number;
  errors: number;
}

type Status = CheckResult['status'];
type Single = Extract<CheckResult, { status: 'below' | 'ok' }>;
type Conflict = Extract<CheckResult, { status: 'conflict' }>;
type NotInJufo = Extract<CheckResult, { status: 'not-in-jufo' }>;
type Failed = Extract<CheckResult, { status: 'error' }>;

const TYPE_LABELS: Record<ChannelType, string> = {
  series: 'lehti/sarja',
  bookpublisher: 'kirjakustantaja',
  conference: 'konferenssi',
};

const NOTE_TEXTS: Record<Exclude<ResultNote, null>, string> = {
  series: 'Taso on julkaisusarjan, ei yksittäisen konferenssin tai kirjan.',
  'series-publisher-not-found':
    'Taso on julkaisusarjan. Kustantajaa ei löytynyt Julkaisufoorumista, joten sen tasoa ei voitu verrata.',
  'conference-publisher': 'Konferenssia ei ole luokiteltu Julkaisufoorumissa erikseen, joten taso on kustantajan.',
};

const BELOW_GROUP_NOTE =
  'Vuodesta 2026 Julkaisufoorumi ei käytä tasoa 0. Kanavat, joilla ei ole tasoluokkaa, ovat ”muita tunnistettuja julkaisukanavia”.';
const CONFLICT_TEXT =
  'Sarjan ja kustantajan tasot ovat ristiriidassa, joten Jufo-luokitusta ei voi luotettavasti varmistaa.';

export function summarize(state: RunState): Summary {
  const count = (status: Status) => state.results.filter((r) => r?.status === status).length;
  return {
    total: state.refs.length,
    done: state.results.filter((r) => r !== undefined).length,
    below: count('below'),
    conflict: count('conflict'),
    notInJufo: count('not-in-jufo'),
    ok: count('ok'),
    errors: count('error'),
  };
}

function sourceCount(n: number): string {
  return n === 1 ? '1 lähde' : `${n} lähdettä`;
}

function summaryText(s: Summary): string {
  const parts = [
    sourceCount(s.total),
    `${s.below} alle tason 1`,
    ...(s.conflict > 0 ? [`${s.conflict} ei voi varmistaa`] : []),
    `${s.notInJufo} ei Jufossa`,
    `${s.ok} kunnossa`,
    ...(s.errors > 0 ? [s.errors === 1 ? '1 virhe' : `${s.errors} virhettä`] : []),
  ];
  return parts.join(' · ');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * "Kanava: Sustainability (lehti/sarja) · varma · avaa Jufo-portaalissa".
 * Ristiriitarivillä otsake ("Sarja", "Kustantaja") kertoo tyypin, joten sitä ei toisteta.
 */
function channelLine(label: string, channel: JufoChannel, confidence: Confidence, showType = true): HTMLElement {
  const line = el('p', 'channel');
  line.append(`${label}: `, el('strong', undefined, channel.title), showType ? ` (${TYPE_LABELS[channel.type]}) · ` : ' · ');
  line.append(el('span', `confidence confidence-${confidence}`, confidence), ' · ');
  line.append(externalLink('avaa Jufo-portaalissa', `${JUFO_PORTAL}${channel.jufoId}`));
  return line;
}

function levelLines(assessment: Assessment, pubYear: number | null): HTMLElement[] {
  const now = `Nyt: ${formatCurrent(assessment.current)}`;
  if (assessment.atPublication !== null && pubYear !== null) {
    return [el('p', 'levels', `${now} · Julkaisuvuonna ${pubYear}: ${formatAtPublication(assessment.atPublication, pubYear)}`)];
  }
  const why =
    assessment.publicationNote === 'before-2012' && pubYear !== null
      ? `Julkaisuvuoden ${pubYear} tasoa ei ole (luokitus alkaa vuodesta ${FIRST_HISTORY_YEAR})`
      : 'Julkaisuvuotta ei tunnistettu; verrattu vain nykyiseen tasoon';
  return [el('p', 'levels', now), el('p', 'levels-note', why)];
}

function externalLink(text: string, href: string): HTMLAnchorElement {
  const link = el('a', undefined, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

const LINKABLE = /https?:\/\/[^\s"<>]+|\bdoi:\s*10\.\d{4,9}\/[^\s"<>]+|\b10\.\d{4,9}\/[^\s"<>]+/gi;
const DOI_ADDRESS = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:|10\.)/i;

/** Osoitetta seuraava välimerkki kuuluu virkkeeseen, ei osoitteeseen. Sulku kuuluu osoitteeseen vain parinsa kanssa. */
function withoutTrailingPunctuation(address: string): string {
  let end = address.length;
  while (end > 0) {
    const last = address[end - 1]!;
    const stray = last === ')' ? !address.slice(0, end - 1).includes('(') : /[.,;:”’'»\]]/.test(last);
    if (!stray) break;
    end--;
  }
  return address.slice(0, end);
}

/**
 * Viitteen teksti, jossa verkko-osoitteet ja DOI:t ovat linkkejä. DOI viedään aina doi.orgiin,
 * joten linkki toimii, vaikka viitteessä olisi "doi:10.…" tai kahdentunut "https://doi.org/https://doi.org/…".
 */
function linkedText(raw: string): Array<string | HTMLAnchorElement> {
  const nodes: Array<string | HTMLAnchorElement> = [];
  let last = 0;
  for (const match of raw.matchAll(LINKABLE)) {
    const address = withoutTrailingPunctuation(match[0]);
    const doi = DOI_ADDRESS.test(address) ? findDoi(address) : null;
    const href = doi ? `https://doi.org/${doi.replace(/[#?]/g, encodeURIComponent)}` : address;
    if (!/^https?:\/\//i.test(href)) continue;
    nodes.push(raw.slice(last, match.index), externalLink(address, href));
    last = match.index + address.length;
  }
  nodes.push(raw.slice(last));
  return nodes.filter((node) => node !== '');
}

/** Yksi lähde. `mark` näytetään marginaalissa: nykyinen taso tai tilan merkki. */
function referenceItem(ref: ShownReference, status: Status, mark: string, ...children: HTMLElement[]): HTMLLIElement {
  const item = el('li', 'result');
  item.dataset.status = status;
  item.dataset.mark = mark;
  const reference = el('p', 'reference');
  reference.append(...linkedText(ref.raw));
  if (ref.key) {
    const key = el('span', 'key', ref.key);
    key.dataset.role = 'key';
    reference.prepend(key, ' ');
  }
  item.append(reference, ...children);
  return item;
}

function singleItem(ref: ShownReference, result: Single): HTMLLIElement {
  const lines = [
    channelLine('Kanava', result.channel, result.confidence),
    ...levelLines(result.assessment, result.pubYear),
  ];
  if (result.assessment.notice) lines.push(el('p', 'notice', result.assessment.notice));
  if (result.note) lines.push(el('p', 'note', NOTE_TEXTS[result.note]));
  const current = result.assessment.current;
  return referenceItem(ref, result.status, current.kind === 'level' ? String(current.level) : '–', ...lines);
}

function conflictItem(ref: ShownReference, result: Conflict): HTMLLIElement {
  return referenceItem(
    ref,
    'conflict',
    '≠',
    el('p', 'notice', CONFLICT_TEXT),
    channelLine('Sarja', result.series.channel, result.series.confidence, false),
    ...levelLines(result.series.assessment, result.pubYear),
    channelLine('Kustantaja', result.publisher.channel, result.publisher.confidence, false),
    ...levelLines(result.publisher.assessment, result.pubYear),
  );
}

function notInJufoItem(ref: ShownReference, result: NotInJufo): HTMLLIElement {
  const explanation =
    result.reason === 'type-not-classified'
      ? 'Julkaisutyyppiä (raportti, opinnäyte, preprint tai aineisto) ei luokitella Julkaisufoorumissa.'
      : result.reason === 'no-channel-identified'
        ? 'Viitteestä ei tunnistettu lehteä eikä kustantajaa. Tämä on tavallista verkkosivuille ja säädöksille.'
        : result.searchedName
          ? `Kanavaa ”${result.searchedName}” ei löytynyt Julkaisufoorumista täsmälleen.`
          : 'Kanavaa ei löytynyt Julkaisufoorumista.';
  const lines = [el('p', 'explanation', explanation)];
  if (result.candidates.length > 0) {
    const list = result.candidates
      .map((c) => `${c.title} – ${c.level.kind === 'level' ? `taso ${c.level.level}` : 'ei tasoluokkaa'}`)
      .join('; ');
    lines.push(el('p', 'candidates', `Mahdollisia kanavia: ${list}`));
  }
  return referenceItem(ref, 'not-in-jufo', '?', ...lines);
}

function errorItem(ref: ShownReference, index: number, result: Failed, onRetry: (index: number) => void): HTMLLIElement {
  const retry = el('button', 'retry', 'Yritä uudelleen');
  retry.type = 'button';
  retry.addEventListener('click', () => onRetry(index));
  return referenceItem(ref, 'error', '!', el('p', 'error', `Haku epäonnistui: ${result.message}`), retry);
}

function group(name: string, title: string, items: HTMLLIElement[], note?: string): HTMLElement | null {
  if (items.length === 0) return null;
  const section = el('section', 'group');
  section.dataset.group = name;
  section.append(el('h2', undefined, `${title} (${sourceCount(items.length)})`));
  if (note) {
    const p = el('p', 'group-note', note);
    p.dataset.role = 'group-note';
    section.append(p);
  }
  const list = el('ul');
  list.append(...items);
  section.append(list);
  return section;
}

export function renderResults(root: HTMLElement, state: RunState, onRetry: (index: number) => void): void {
  const okWasOpen = root.querySelector<HTMLDetailsElement>('details[data-group=ok]')?.open ?? false;
  root.replaceChildren();
  root.removeAttribute('aria-busy');
  if (state.refs.length === 0) return;

  const items: Record<Status, HTMLLIElement[]> = { error: [], below: [], conflict: [], 'not-in-jufo': [], ok: [] };
  state.results.forEach((result, index) => {
    if (!result) return;
    const ref = state.refs[index]!;
    switch (result.status) {
      case 'error':
        items.error.push(errorItem(ref, index, result, onRetry));
        break;
      case 'conflict':
        items.conflict.push(conflictItem(ref, result));
        break;
      case 'not-in-jufo':
        items['not-in-jufo'].push(notInJufoItem(ref, result));
        break;
      default:
        items[result.status].push(singleItem(ref, result));
    }
  });

  const summary = summarize(state);
  // Hakuja on kesken, kunnes jokaisella lähteellä on tulos (myös uudelleenyrityksen aikana).
  const busy = summary.done < summary.total;
  root.setAttribute('aria-busy', String(busy));
  const status = el('div', 'status');
  if (busy) {
    const spinner = el('span', 'spinner');
    spinner.dataset.role = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    status.append(spinner);
  }
  const progress = el('p', 'progress', `${summary.done} / ${summary.total} tarkistettu`);
  progress.dataset.role = 'progress';
  status.append(progress);
  const summaryLine = el('p', 'summary', summaryText(summary));
  summaryLine.dataset.role = 'summary';
  root.append(status, summaryLine);

  const sections = [
    group('errors', 'Haku epäonnistui', items.error),
    group('below', 'Alle tason 1', items.below, BELOW_GROUP_NOTE),
    group('conflict', 'Ei voi varmistaa', items.conflict),
    group('not-in-jufo', 'Ei löytynyt Julkaisufoorumista', items['not-in-jufo']),
  ];
  for (const section of sections) if (section) root.append(section);

  if (items.ok.length > 0) {
    const details = el('details', 'group');
    details.dataset.group = 'ok';
    details.open = okWasOpen;
    const list = el('ul');
    list.append(...items.ok);
    details.append(el('summary', undefined, `Kunnossa (${sourceCount(items.ok.length)})`), list);
    root.append(details);
  }
}
