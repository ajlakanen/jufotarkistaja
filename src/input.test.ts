import { readReferences } from './input';

const A = 'Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. Qualitative Research in Psychology, 3(2), 77–101.';
const B = 'Virtanen, A. (2019). Kestävä kehitys kunnissa. Sustainability, 11(4), 1–15.';

it('BibTeX-kirjasto luetaan tietueina', () => {
  const refs = readReferences('@article{a, title = {Otsikko}, journal = {Kasvatus}, year = {2020}}\n\n@book{b, title = {Kirja}, publisher = {Tammi}}');
  expect(refs.map((r) => [r.key, r.container, r.publisher, r.year])).toEqual([
    ['a', 'Kasvatus', null, 2020],
    ['b', null, 'Tammi', null],
  ]);
});

it('muu teksti erotellaan lähteiksi ja jäsennetään viitteinä', () => {
  const refs = readReferences(`Lähteet\n\n${A}\n${B}\n`);
  expect(refs.map((r) => [r.key, r.raw, r.year, r.container])).toEqual([
    [undefined, A, 2006, 'Qualitative Research in Psychology'],
    [undefined, B, 2019, 'Sustainability'],
  ]);
});

it('tyhjä syöte → ei lähteitä', () => {
  expect(readReferences('  \n')).toEqual([]);
});
