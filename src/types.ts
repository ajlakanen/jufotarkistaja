export type Level = 1 | 2 | 3;
export type LevelReading =
  | { kind: 'level'; level: Level }
  | { kind: 'none' }      // ei tasoluokkaa (null / 0)
  | { kind: 'unrated' };  // ei arvioitu sinä vuonna ("" tai vuosi puuttuu); vain historiassa

export type ChannelType = 'series' | 'bookpublisher' | 'conference';

export interface JufoChannel {
  jufoId: number;
  title: string;
  otherTitles: string[];           // title_other puolipisteistä jaettuna, trimmattuna, tyhjät pois
  type: ChannelType;
  abbreviation: string | null;
  issns: string[];                 // issn_print, issn_electronic, issnl; ei null-arvoja, ei toistoja
  level: LevelReading;             // 'level' tai 'none'
  history: Record<number, LevelReading>;
}

export type KindHint = 'article' | 'book' | 'conference' | 'unclassifiable' | null;

export interface ParsedReference {
  raw: string;                     // näytettävä viite; BibTeX-tietueesta koottu rivi
  key?: string;                    // BibTeX-avain, kun lähde tuli BibTeX-kirjastosta
  doi: string | null;
  issn: string | null;             // viitteeseen kirjoitettu ISSN, muodossa NNNN-NNNX
  year: number | null;
  title: string | null;
  container: string | null;        // lehden tai konferenssijulkaisun nimi
  publisher: string | null;
  conferenceAbbr: string | null;
  kindHint: KindHint;
}

export interface CrossrefWork {
  doi: string;
  title: string;
  type: string;                    // Crossrefin tyyppi sellaisenaan
  containerTitles: string[];
  issns: string[];
  publisher: string | null;
  year: number | null;
  eventName: string | null;        // Crossrefin event.name, esim. "CHI '19: Human Factors in Computing Systems"
}

export type Confidence = 'varma' | 'tarkista';

export interface Assessment {
  current: LevelReading;
  atPublication: LevelReading | null;                    // null = ei vertailua
  publicationNote: 'before-2012' | 'year-unknown' | null;
  below: boolean;
  notice: string | null;
}

// 'series' = taso on sarjan; 'series-publisher-not-found' = taso on sarjan (alle 1), kustantajaa ei löytynyt vertailuun;
// 'conference-publisher' = konferenssia ei ole luokiteltu, taso on kustantajan
export type ResultNote = 'series' | 'series-publisher-not-found' | 'conference-publisher' | null;

export interface Matched { channel: JufoChannel; confidence: Confidence; assessment: Assessment }

export type NotInJufoReason = 'channel-not-found' | 'no-channel-identified' | 'type-not-classified';

export type CheckResult =
  | { status: 'below' | 'ok'; raw: string; channel: JufoChannel; confidence: Confidence;
      note: ResultNote; pubYear: number | null; assessment: Assessment }
  | { status: 'conflict'; raw: string; pubYear: number | null; series: Matched; publisher: Matched }
  | { status: 'not-in-jufo'; raw: string; reason: NotInJufoReason;
      searchedName: string | null; candidates: JufoChannel[] }
  | { status: 'error'; raw: string; message: string };

export interface JufoApi {
  byIssn(issn: string): Promise<JufoChannel | null>;
  byName(name: string, type: ChannelType): Promise<JufoChannel[]>;
  byAbbr(abbr: string): Promise<JufoChannel[]>;
}
export interface CrossrefApi {
  byDoi(doi: string): Promise<CrossrefWork | null>;      // null = 404
  search(raw: string): Promise<CrossrefWork | null>;     // paras osuma tai null
}
export type FetchJson = (url: string, signal?: AbortSignal) => Promise<unknown>;
