import { decodeEntities, normalizeChannelName, normalizeText, titleInReference } from './normalize';

it.each([
  ['Qualitative Research in Psychology', 'qualitative research in psychology'],
  ['  MRS Energy & Sustainability: A Review ', 'mrs energy and sustainability a review'],
  ['Hirsjärvi – Tutki, ja kirjoita!', 'hirsjarvi tutki ja kirjoita'],
])('normalizeText(%j)', (input, expected) => expect(normalizeText(input)).toBe(expected));

it.each([
  ['SAGE', 'sage'],
  ['Sage publications', 'sage'],
  ['John Wiley & Sons, Inc.', 'john wiley'],
  ['Kustannusosakeyhtiö Tammi', 'tammi'],
  ['Oxford University Press', 'oxford university'],
  ['Taylor & Francis', 'taylor and francis'],
  ['PS-kustannus', 'ps'],
  ['Press', 'press'], // tulos ei saa tyhjentyä
  ['The MIT Press', 'mit'], // artikkeli nimen alussa ei kuulu nimeen
  ['The Lancet', 'lancet'],
  ['Theatre Journal', 'theatre journal'],
])('normalizeChannelName(%j)', (input, expected) => expect(normalizeChannelName(input)).toBe(expected));

it('titleInReference', () => {
  const raw = 'Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. Qualitative Research in Psychology, 3(2), 77–101.';
  expect(titleInReference('Using Thematic Analysis in Psychology', raw)).toBe(true);
  expect(titleInReference('Tutki, lue, kirjoita ja ajattele!', 'Hirsjärvi, S. (2009). Tutki ja kirjoita. Tammi.')).toBe(false);
  expect(titleInReference('Editorial', 'Smith, J. (2020). Editorial. Nature, 1, 1.')).toBe(false); // alle 10 merkkiä
});

it('decodeEntities purkaa nimetyt ja numeeriset entiteetit, muu teksti säilyy', () => {
  expect(decodeEntities('Languages &amp; Applications')).toBe('Languages & Applications');
  expect(decodeEntities('&lt;i&gt;x&lt;/i&gt; &quot;a&quot; &apos;b&apos; &#39;c&#x27; &#228;&nbsp;z')).toBe('<i>x</i> "a" \'b\' \'c\' ä\u00a0z');
  expect(decodeEntities('AT&T; R&D &tuntematon; &#99999999;')).toBe('AT&T; R&D &tuntematon; &#99999999;');
});
