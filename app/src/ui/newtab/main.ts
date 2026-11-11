import type { NewTabState } from '../../shared/ipc/newtab-contracts.ts';
import { Translator, pageLanguage } from '../i18n/i18n.ts';

const i18n = new Translator(pageLanguage());
document.documentElement.lang = i18n.language;
document.title = i18n.t('newtab.title');
const form = document.getElementById('search');
const query = document.getElementById('query');
const clock = document.getElementById('clock');
const tiles = document.getElementById('tiles');
// In a private window, the page tells what the window keeps.
const note = document.getElementById('private');
if (note !== null && document.documentElement.hasAttribute('data-private')) {
  note.textContent = i18n.t('newtab.private');
  note.hidden = false;
}

/** The time on the clock, which changes at the start of each minute while the page shows. */
let tick: ReturnType<typeof setTimeout> | undefined;
function showTime(): void {
  if (!(clock instanceof HTMLTimeElement) || clock.hidden) return;
  const now = new Date();
  clock.textContent = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(now);
  clock.dateTime = now.toISOString();
  clearTimeout(tick);
  if (document.visibilityState === 'visible') {
    tick = setTimeout(showTime, 60_000 - (now.getTime() % 60_000));
  }
}
document.addEventListener('visibilitychange', showTime);

function isTile(value: unknown): value is NewTabState['tiles'][number] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof value.title === 'string' &&
    'url' in value &&
    typeof value.url === 'string'
  );
}

/** Whether the browser sent the state of the page in the shape the page shows. */
function isNewTabState(value: unknown): value is NewTabState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'engine' in value &&
    (typeof value.engine === 'string' || value.engine === null) &&
    'search' in value &&
    typeof value.search === 'boolean' &&
    'clock' in value &&
    typeof value.clock === 'boolean' &&
    'tiles' in value &&
    Array.isArray(value.tiles) &&
    value.tiles.every(isTile)
  );
}

/** Shows what the settings say: the search field, the clock and the tiles. */
function show(state: NewTabState): void {
  if (form instanceof HTMLFormElement && query instanceof HTMLInputElement) {
    form.hidden = !state.search;
    const label =
      state.engine === null
        ? i18n.t('newtab.placeholder')
        : i18n.t('newtab.placeholderEngine', { engine: state.engine });
    query.placeholder = label;
    query.setAttribute('aria-label', label);
  }
  if (clock instanceof HTMLTimeElement) {
    clock.hidden = !state.clock;
    if (state.clock) showTime();
    else clearTimeout(tick);
  }
  if (tiles instanceof HTMLUListElement) {
    tiles.hidden = state.tiles.length === 0;
    tiles.setAttribute('aria-label', i18n.t('newtab.tiles'));
    tiles.replaceChildren(
      ...state.tiles.map((tile) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = tile.url;
        const letter = document.createElement('span');
        letter.className = 'letter';
        letter.setAttribute('aria-hidden', 'true');
        const title = tile.title === '' ? new URL(tile.url).hostname : tile.title;
        letter.textContent = title.slice(0, 1).toUpperCase();
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = title;
        link.append(letter, name);
        // The page cannot leave its origin; the browser opens the tile in this tab.
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void window.bridge.invoke('newtab.navigate', { input: tile.url });
        });
        item.append(link);
        return item;
      }),
    );
  }
}

if (form instanceof HTMLFormElement && query instanceof HTMLInputElement) {
  query.placeholder = i18n.t('newtab.placeholder');
  query.setAttribute('aria-label', i18n.t('newtab.placeholder'));
  void window.bridge.invoke('newtab.getState', {}).then((state) => {
    if (isNewTabState(state)) show(state);
  });
  window.bridge.on('newtab.changed', (state) => {
    if (isNewTabState(state)) show(state);
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
