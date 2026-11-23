import { FIRST_HISTORY_YEAR, JufoFormatError, assess, formatAtPublication, formatCurrent, readCurrentLevel, readHistoryLevel } from './levels';

const L = (n: 1 | 2 | 3) => ({ kind: 'level', level: n }) as const;
const NONE = { kind: 'none' } as const, UNRATED = { kind: 'unrated' } as const;

it('readCurrentLevel', () => {
  expect(readCurrentLevel(3)).toEqual(L(3));
  expect(readCurrentLevel('2')).toEqual(L(2));     // merkkijonomuoto hyväksytään
  expect(readCurrentLevel(null)).toEqual(NONE);
  expect(readCurrentLevel(0)).toEqual(NONE);
  for (const bad of ['x', 4, '', undefined, {}]) expect(() => readCurrentLevel(bad)).toThrow(JufoFormatError);
});
it('readHistoryLevel', () => {
  expect(readHistoryLevel('2')).toEqual(L(2));
  expect(readHistoryLevel(1)).toEqual(L(1));
  for (const none of ['0', 0, null]) expect(readHistoryLevel(none)).toEqual(NONE);
  expect(readHistoryLevel('')).toEqual(UNRATED);
  for (const bad of ['x', 4, '4', {}]) expect(() => readHistoryLevel(bad)).toThrow(JufoFormatError);
});

const sustainability = { level: NONE, history: { 2019: L(1), 2022: L(1), 2023: NONE, 2026: NONE } };
const risen = { level: L(1), history: { 2015: NONE, 2025: UNRATED, 2026: L(1) } };

it('taso poistunut julkaisun jälkeen', () => {
  expect(assess(sustainability, 2019)).toEqual({ current: NONE, atPublication: L(1), publicationNote: null, firstRated: null, below: true,
    notice: 'Taso on poistunut julkaisun jälkeen (julkaisuvuonna 2019 taso 1).' });
});
it('molemmat ilman tasoa → ei huomautusta', () => {
  expect(assess(sustainability, 2023)).toMatchObject({ below: true, notice: null });
});
it('noussut tasolle', () => {
  expect(assess(risen, 2015)).toMatchObject({ below: true,
    notice: 'Kanava on noussut tasolle 1 julkaisun jälkeen (julkaisuvuonna 2015 taso 0).' });
});
it('ei arvioitu julkaisuvuonna', () => {
  expect(assess(risen, 2025)).toMatchObject({ below: true, atPublication: UNRATED,
    notice: 'Kanavaa ei ollut vielä arvioitu julkaisuvuonna 2025; nyt taso 1.' });
  expect(assess({ level: NONE, history: { 2025: UNRATED } }, 2025).notice)
    .toBe('Kanavaa ei ollut vielä arvioitu julkaisuvuonna 2025; nyt ei tasoluokkaa.');
});
it('vuosi puuttuu historiasta → ei arvioitu', () => {
  expect(assess({ level: L(1), history: { 2012: L(1), 2026: L(1) } }, 2020).atPublication).toEqual(UNRATED);
});
it('ennen 2012, tuntematon vuosi ja tuleva vuosi', () => {
  const ch = { level: L(2), history: { 2012: L(2), 2026: L(2) } };
  expect(assess(ch, 2006)).toEqual({ current: L(2), atPublication: null, publicationNote: 'before-2012',
    firstRated: { year: 2012, level: L(2) }, below: false, notice: null });
  expect(assess(ch, null)).toMatchObject({ atPublication: null, publicationNote: 'year-unknown', firstRated: null, below: false });
  expect(assess(ch, 2027)).toMatchObject({ atPublication: L(2), firstRated: null, below: false });   // historian jälkeen → nykyinen
});

describe('ennen vuotta 2012 julkaistu: vertailukohta on ensimmäinen arvioitu taso', () => {
  const sage = { level: L(3), history: { 2012: L(2), 2014: L(2), 2015: L(3), 2026: L(3) } };

  it('taso noussut ensimmäisestä arviosta → kunnossa, mutta huomautus', () => {
    expect(assess(sage, 1995)).toEqual({ current: L(3), atPublication: null, publicationNote: 'before-2012',
      firstRated: { year: 2012, level: L(2) }, below: false,
      notice: 'Kanava on noussut tasolta 2 tasolle 3 ensimmäisen arvioinnin (2012) jälkeen.' });
  });
  it('taso laskenut ensimmäisestä arviosta → kunnossa, mutta huomautus', () => {
    expect(assess({ level: L(1), history: { 2012: L(2), 2026: L(1) } }, 2001)).toMatchObject({ below: false,
      notice: 'Kanava on laskenut tasolta 2 tasolle 1 ensimmäisen arvioinnin (2012) jälkeen.' });
  });
  it('ensimmäinen arvio oli taso 0 → alle tason 1, vaikka nyt on taso', () => {
    expect(assess({ level: L(1), history: { 2012: NONE, 2020: L(1), 2026: L(1) } }, 2005)).toMatchObject({
      firstRated: { year: 2012, level: NONE }, below: true,
      notice: 'Kanava on noussut tasolle 1 ensimmäisen arvioinnin jälkeen (vuonna 2012 taso 0).' });
  });
  it('taso poistunut ensimmäisen arvion jälkeen', () => {
    expect(assess(sustainability, 2006)).toMatchObject({ firstRated: { year: 2019, level: L(1) }, below: true,
      notice: 'Taso on poistunut ensimmäisen arvioinnin jälkeen (vuonna 2019 taso 1).' });
  });
  it('ei arvioidut vuodet ohitetaan: ensimmäinen arvio voi olla vuotta 2012 myöhempi', () => {
    expect(assess({ level: L(1), history: { 2012: UNRATED, 2013: UNRATED, 2018: L(1), 2026: L(1) } }, 2003))
      .toMatchObject({ firstRated: { year: 2018, level: L(1) }, below: false, notice: null });
  });
  it('ei yhtään arvioitua vuotta → verrataan vain nykyiseen tasoon', () => {
    expect(assess({ level: L(1), history: { 2012: UNRATED } }, 2003)).toMatchObject({ firstRated: null, below: false, notice: null });
    expect(assess({ level: NONE, history: {} }, 2003)).toMatchObject({ firstRated: null, below: true, notice: null });
  });
});
it('molemmat vähintään 1 mutta eri → kunnossa, ei huomautusta', () => {
  expect(assess({ level: L(2), history: { 2020: L(3), 2026: L(2) } }, 2020)).toMatchObject({ below: false, notice: null });
});
it('näyttötekstit', () => {
  expect(formatCurrent(L(2))).toBe('taso 2');
  expect(formatCurrent(NONE)).toBe('ei tasoluokkaa (aiemmin taso 0)');
  expect(formatAtPublication(L(1), 2019)).toBe('taso 1');
  expect(formatAtPublication(NONE, 2019)).toBe('taso 0');
  expect(formatAtPublication(NONE, 2026)).toBe('ei tasoluokkaa');
  expect(formatAtPublication(UNRATED, 2025)).toBe('ei vielä arvioitu');
});

it('historia alkaa vuodesta 2012', () => expect(FIRST_HISTORY_YEAR).toBe(2012));
