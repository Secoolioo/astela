import type { NewTabState } from '../../shared/ipc/newtab-contracts.ts';
import { Translator, pageLanguage } from '../i18n/i18n.ts';

const i18n = new Translator(pageLanguage());
document.documentElement.lang = i18n.language;
document.title = i18n.t('newtab.title');
const form = document.getElementById('search');
const query = document.getElementById('query');
const clock = document.getElementById('clock');
const tiles = document.getElementById('tiles');
const top = document.getElementById('top');
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
    value.tiles.every(isTile) &&
    'mostVisited' in value &&
    Array.isArray(value.mostVisited) &&
    value.mostVisited.every(isTile) &&
    'background' in value &&
    isBackground(value.background)
  );
}

function isHex(color: unknown): boolean {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

function isBackground(value: unknown): value is NewTabState['background'] {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  switch (value.kind) {
    case 'none':
      return true;
    case 'color':
      return 'color' in value && isHex(value.color);
    case 'gradient':
      return 'from' in value && isHex(value.from) && 'to' in value && isHex(value.to);
    case 'image':
      return (
        'file' in value &&
        typeof value.file === 'string' &&
        /^background-[0-9a-f]{16}\.(?:png|jpg|webp|gif|avif)$/.test(value.file)
      );
    default:
      return false;
  }
}

/** The background of the page, as CSS, or nothing for the page's own color. */
function backgroundCss(background: NewTabState['background']): string | undefined {
  if (background.kind === 'color') return background.color;
  if (background.kind === 'gradient') {
    return `linear-gradient(135deg, ${background.from}, ${background.to})`;
  }
  if (background.kind === 'image') {
    return `url("/background/${background.file}") center / cover no-repeat`;
  }
  return undefined;
}

/** Fills a list with tiles that open their pages in this tab. */
function showTiles(list: HTMLUListElement, entries: NewTabState['tiles'], label: string): void {
  list.hidden = entries.length === 0;
  list.setAttribute('aria-label', label);
  list.replaceChildren(
    ...entries.map((tile) => {
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

/** Shows what the settings say: the search field, the clock, the tiles and the background. */
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
  if (tiles instanceof HTMLUListElement) showTiles(tiles, state.tiles, i18n.t('newtab.tiles'));
  if (top instanceof HTMLUListElement) {
    showTiles(top, state.mostVisited, i18n.t('newtab.mostVisited'));
  }
  // The page's background, which a style of the page's own takes from a property.
  const background = backgroundCss(state.background);
  const root = document.documentElement;
  if (background === undefined) root.style.removeProperty('--newtab-background');
  else root.style.setProperty('--newtab-background', background);
  document.documentElement.classList.toggle('has-background', background !== undefined);
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
