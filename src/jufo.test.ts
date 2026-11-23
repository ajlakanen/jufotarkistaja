import { JufoFormatError } from './levels';
import { createJufoApi, matchByName, normalizeIssn, parseChannel } from './jufo';
import sustainability from './__fixtures__/jufo/issn-sustainability.json';
import nature from './__fixtures__/jufo/issn-nature.json';
import commSust from './__fixtures__/jufo/issn-communications-sustainability.json';
import tammi from './__fixtures__/jufo/name-tammi.json';
import wiley from './__fixtures__/jufo/name-wiley.json';
import sage from './__fixtures__/jufo/name-sage.json';
import unrelated from './__fixtures__/jufo/unrelated-default-list.json';

it.each([['1687725x', '1687-725X'], ['2071-1050', '2071-1050'], [' 0028 0836 ', '0028-0836'], ['12345', null], ['', null]])
  ('normalizeIssn(%j)', (i, e) => expect(normalizeIssn(i)).toBe(e));

it('parseChannel: Sustainability', () => {
  const c = parseChannel(sustainability[0]);
  expect(c).toMatchObject({ jufoId: 71524, title: 'Sustainability', type: 'series',
    issns: ['2071-1050'], level: { kind: 'none' } });
  expect(c.history[2019]).toEqual({ kind: 'level', level: 1 });
  expect(c.history[2023]).toEqual({ kind: 'none' });
});
it('parseChannel: Nature, Tammi, Communications sustainability', () => {
  expect(parseChannel(nature[0])).toMatchObject({ level: { kind: 'level', level: 3 }, issns: ['0028-0836', '1476-4687'] });
  expect(parseChannel(tammi[0])).toMatchObject({ jufoId: 7269, type: 'bookpublisher', otherTitles: ['Kustannusosakeyhtiö Tammi'], issns: [] });
  expect(parseChannel(commSust[0]).history[2025]).toEqual({ kind: 'unrated' });
});
it('parseChannel: vasta lisätyllä kanavalla ei ole tasohistoriaa (level_history: null)', () => {
  // Jufo 94087 (ISMAR), lisätty 20.5.2026: arvio on vasta tulossa (level_pending).
  const c = parseChannel({ ...sustainability[0], jufo_id: 94087, level: null, level_history: null, level_pending: 2 });
  expect(c).toMatchObject({ jufoId: 94087, level: { kind: 'none' }, history: {} });
});
it('parseChannel hylkää odottamattoman muodon', () => {
  const base = sustainability[0];
  expect(() => parseChannel({ ...base, level: 'x' })).toThrow(JufoFormatError);
  expect(() => parseChannel({ ...base, level_history: '2012:1;' })).toThrow(JufoFormatError);
  expect(() => parseChannel({ ...base, type: { id: 'Blog' } })).toThrow(JufoFormatError);
  expect(() => parseChannel(null)).toThrow(JufoFormatError);
});

it('byIssn rakentaa osoitteen ja varmistaa tuloksen', async () => {
  const urls: string[] = [];
  const api = createJufoApi(async (u) => (urls.push(u), sustainability));
  expect((await api.byIssn('2071-1050'))?.jufoId).toBe(71524);
  expect(urls).toEqual(['https://jufo-rest.csc.fi/v2.1/search?issn=2071-1050&_size=100']);
});
it('byIssn palauttaa null, jos tuloksessa ei ole haettua ISSN:ää', async () => {
  expect(await createJufoApi(async () => unrelated).byIssn('2071-1050')).toBeNull();
  expect(await createJufoApi(async () => []).byIssn('2071-1050')).toBeNull();
});
it('byName ja byAbbr rakentavat osoitteet', async () => {
  const urls: string[] = [];
  const api = createJufoApi(async (u) => (urls.push(u), []));
  await api.byName('Taylor & Francis', 'bookpublisher');
  await api.byAbbr('CHI');
  expect(urls).toEqual([
    'https://jufo-rest.csc.fi/v2.1/search?name=Taylor+%26+Francis&type=bookpublisher&_size=100',
    'https://jufo-rest.csc.fi/v2.1/search?abbr=CHI&type=conference&_size=100',
  ]);
});
it('rajapinta, joka ei palauta taulukkoa → JufoFormatError', async () => {
  await expect(createJufoApi(async () => ({ error: 'x' })).byName('a', 'series')).rejects.toThrow(JufoFormatError);
});

it('matchByName', () => {
  const sageList = sage.map(parseChannel), wileyList = wiley.map(parseChannel), tammiList = tammi.map(parseChannel);
  expect(matchByName('SAGE', sageList)?.jufoId).toBe(5892);            // "Sage publications"
  expect(matchByName('Wiley', wileyList)).toBeNull();                   // ei täsmäosumaa
  expect(matchByName('Kustannusosakeyhtiö Tammi', tammiList)?.jufoId).toBe(7269);
  expect(matchByName('SAGE', [...sageList, { ...sageList[0]!, jufoId: 1 }])).toBeNull(); // kaksi täsmäävää → epäselvä
});
