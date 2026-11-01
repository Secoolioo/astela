import { Translator, pickLanguage } from '../i18n/i18n.ts';

const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
document.title = i18n.t('newtab.title');
const form = document.getElementById('search');
const query = document.getElementById('query');

if (form instanceof HTMLFormElement && query instanceof HTMLInputElement) {
  query.placeholder = i18n.t('newtab.placeholder');
  query.setAttribute('aria-label', i18n.t('newtab.placeholder'));
  void window.bridge.invoke('newtab.getState', {}).then((state) => {
    const engine =
      typeof state === 'object' && state !== null && 'engine' in state ? state.engine : null;
    if (typeof engine === 'string') {
      const label = i18n.t('newtab.placeholderEngine', { engine });
      query.placeholder = label;
      query.setAttribute('aria-label', label);
    }
  });
  // The page cannot submit forms or leave its origin; the browser opens the result instead.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = query.value.trim();
    if (input !== '') {
      void window.bridge.invoke('newtab.navigate', { input });
    }
  });
  // Tells the self-test that the page's script has run.
  document.documentElement.dataset['ready'] = 'true';
}
