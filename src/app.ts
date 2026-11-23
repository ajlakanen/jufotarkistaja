// Sivun tapahtumat: Tarkista-painike käynnistää ajon, uusi ajo keskeyttää edellisen.
import { readReferences } from './input';
import { renderResults, type RunState } from './render';
import { runChecks } from './runner';
import type { CheckResult, ParsedReference } from './types';

export type Resolver = (ref: ParsedReference) => Promise<CheckResult>;

const IDLE_LABEL = 'Tarkista';
const RUNNING_LABEL = 'Tarkistetaan…';
const EMPTY_HINT = 'Liitä ensin lähdeluettelo.';

/**
 * Kytkee sivun elementit (#input, #refs, #check, #hint, #edit, #results) tarkistukseen.
 * Kenttään voi liittää lähdeluettelon tai BibTeX-kirjaston. Kun luettelo on annettu, syöttökenttä piilotetaan tulosten tieltä; #edit tuo sen takaisin.
 * `createResolver` kutsutaan kerran jokaista ajoa kohden, jotta ajolla on oma välimuistinsa.
 * Sen saama signaali keskeytyy, kun käyttäjä aloittaa uuden ajon.
 */
export function initApp(doc: Document, createResolver: (signal: AbortSignal) => Resolver): void {
  const textarea = doc.querySelector<HTMLTextAreaElement>('#refs')!;
  const button = doc.querySelector<HTMLButtonElement>('#check')!;
  const hint = doc.querySelector<HTMLElement>('#hint')!;
  const results = doc.querySelector<HTMLElement>('#results')!;
  const input = doc.querySelector<HTMLElement>('#input')!;
  const edit = doc.querySelector<HTMLButtonElement>('#edit')!;

  const showInput = (visible: boolean): void => {
    input.hidden = !visible;
    edit.hidden = visible;
  };

  edit.addEventListener('click', () => {
    showInput(true);
    textarea.focus();
  });

  let current: AbortController | null = null;

  button.addEventListener('click', () => {
    const refs = readReferences(textarea.value);
    if (refs.length === 0) {
      hint.textContent = EMPTY_HINT;
      hint.hidden = false;
      return;
    }
    hint.hidden = true;
    showInput(false);

    current?.abort();
    const run = new AbortController();
    current = run;
    const live = () => current === run;

    const resolve = createResolver(run.signal);
    const state: RunState = { refs, results: refs.map(() => undefined), running: true };

    const retry = (index: number): void => {
      state.results[index] = undefined;
      draw();
      void resolve(refs[index]!).then((result) => {
        if (!live()) return;
        state.results[index] = result;
        draw();
      });
    };
    const draw = (): void => {
      if (live()) renderResults(results, state, retry);
    };

    button.textContent = RUNNING_LABEL;
    draw();

    void runChecks(refs, resolve, (index, result) => {
      state.results[index] = result;
      draw();
    }, { signal: run.signal }).then(() => {
      if (!live()) return;
      state.running = false;
      button.textContent = IDLE_LABEL;
      draw();
    });
  });
}
