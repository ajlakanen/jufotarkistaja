import './style.css';
import { initApp } from './app';
import { createCrossrefApi } from './crossref';
import { createFetchJson, serialized } from './http';
import { createJufoApi } from './jufo';
import { resolveParsed } from './resolve';
import { cachedCrossref, cachedJufo } from './runner';

const fetchJson = createFetchJson();
// Crossref sallii yhden pyynnön kerrallaan; jono on yhteinen kaikille ajoille.
const crossrefQueue = serialized(fetchJson);

initApp(document, (signal) => {
  // Uudet asiakkaat jokaiselle ajolle: välimuisti elää vain yhden tarkistuksen ajan,
  // ja keskeytetyn ajon haut perutaan.
  const deps = {
    jufo: cachedJufo(createJufoApi((url) => fetchJson(url, signal))),
    crossref: cachedCrossref(createCrossrefApi((url) => crossrefQueue(url, signal))),
  };
  return (ref) => resolveParsed(ref, deps);
});
