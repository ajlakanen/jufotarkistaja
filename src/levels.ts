// Jufo-tasoarvojen tulkinta ja lähteen arvio (nykyinen taso ja julkaisuvuoden taso).
import type { Assessment, JufoChannel, Level, LevelReading } from './types';

export const FIRST_HISTORY_YEAR = 2012;

/** Rajapinnan vastaus ei ollut odotettua muotoa. Näytetään virheenä, ei tulkita hiljaa. */
export class JufoFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JufoFormatError';
  }
}

const NONE: LevelReading = { kind: 'none' };
const UNRATED: LevelReading = { kind: 'unrated' };

function asLevel(raw: unknown): LevelReading | null {
  const n = typeof raw === 'string' && /^[123]$/.test(raw) ? Number(raw) : raw;
  return n === 1 || n === 2 || n === 3 ? { kind: 'level', level: n as Level } : null;
}

/** Kentän `level` arvo: 1–3, tai null/0 = ei tasoluokkaa. */
export function readCurrentLevel(raw: unknown): LevelReading {
  const level = asLevel(raw);
  if (level) return level;
  if (raw === null || raw === 0 || raw === '0') return NONE;
  throw new JufoFormatError(`Odottamaton tasoarvo: ${JSON.stringify(raw)}`);
}

/** Kentän `level_history` yhden vuoden arvo: "1"–"3", "0"/null = ei tasoluokkaa, "" = ei arvioitu. */
export function readHistoryLevel(raw: unknown): LevelReading {
  const level = asLevel(raw);
  if (level) return level;
  if (raw === null || raw === 0 || raw === '0') return NONE;
  if (raw === '') return UNRATED;
  throw new JufoFormatError(`Odottamaton tasohistorian arvo: ${JSON.stringify(raw)}`);
}

export function formatCurrent(r: LevelReading): string {
  return r.kind === 'level' ? `taso ${r.level}` : 'ei tasoluokkaa (aiemmin taso 0)';
}

export function formatAtPublication(r: LevelReading, year: number): string {
  if (r.kind === 'level') return `taso ${r.level}`;
  if (r.kind === 'unrated') return 'ei vielä arvioitu';
  return year < 2026 ? 'taso 0' : 'ei tasoluokkaa';
}

function levelAtPublication(channel: Pick<JufoChannel, 'level' | 'history'>, year: number): LevelReading {
  const years = Object.keys(channel.history).map(Number);
  if (years.length > 0 && year > Math.max(...years)) return channel.level;
  return channel.history[year] ?? UNRATED;
}

function noticeFor(current: LevelReading, atPublication: LevelReading, year: number): string | null {
  if (current.kind === atPublication.kind) return null;
  const then = formatAtPublication(atPublication, year);
  if (atPublication.kind === 'unrated') {
    const now = current.kind === 'level' ? `taso ${current.level}` : 'ei tasoluokkaa';
    return `Kanavaa ei ollut vielä arvioitu julkaisuvuonna ${year}; nyt ${now}.`;
  }
  if (current.kind === 'level') {
    return `Kanava on noussut tasolle ${current.level} julkaisun jälkeen (julkaisuvuonna ${year} ${then}).`;
  }
  return `Taso on poistunut julkaisun jälkeen (julkaisuvuonna ${year} ${then}).`;
}

export function assess(channel: Pick<JufoChannel, 'level' | 'history'>, pubYear: number | null): Assessment {
  const current = channel.level;
  if (pubYear === null || pubYear < FIRST_HISTORY_YEAR) {
    return {
      current,
      atPublication: null,
      publicationNote: pubYear === null ? 'year-unknown' : 'before-2012',
      below: current.kind !== 'level',
      notice: null,
    };
  }
  const atPublication = levelAtPublication(channel, pubYear);
  const below = current.kind !== 'level' || atPublication.kind !== 'level';
  return {
    current,
    atPublication,
    publicationNote: null,
    below,
    notice: below ? noticeFor(current, atPublication, pubYear) : null,
  };
}
