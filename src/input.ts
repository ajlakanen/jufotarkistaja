// Syöttökentän teksti lähteiksi: BibTeX-kirjasto luetaan tietueina, muu teksti liitettynä lähdeluettelona.
import { isBibtex, parseBibtex } from './bibtex';
import { parseReference } from './parse';
import { splitReferences } from './split';
import type { ParsedReference } from './types';

export function readReferences(text: string): ParsedReference[] {
  return isBibtex(text) ? parseBibtex(text) : splitReferences(text).map(parseReference);
}
