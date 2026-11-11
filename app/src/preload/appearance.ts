import { ipcRenderer, webFrame } from 'electron';
import { privateWindowArgument } from '../shared/private-window.ts';
import { languageOfArguments, localeOfArguments } from '../shared/ui-language.ts';

/**
 * Applies the browser's accent and density to the page before its first paint, and again
 * whenever they change, and gives the page the language of the settings. The style sheet
 * comes from the browser process, on the command line at start and as an event later; the
 * page itself never sees or handles it.
 */
export function applyAppearance(): void {
  const argument = process.argv.find((arg) => arg.startsWith('--appearance='));
  let key =
    argument === undefined
      ? undefined
      : webFrame.insertCSS(decodeURIComponent(argument.slice('--appearance='.length)));
  ipcRenderer.on('appearance.changed', (_event, css: unknown) => {
    if (typeof css !== 'string' || css.length > 4096) {
      return;
    }
    if (key !== undefined) {
      webFrame.removeInsertedCSS(key);
    }
    key = webFrame.insertCSS(css);
  });
  // The browser's own views in a private window look dark in both modes (tokens.css).
  if (process.argv.includes(privateWindowArgument)) markRoot('private', '');
  // The page translates itself with this language when it starts (ui/i18n).
  const language = languageOfArguments(process.argv);
  if (language !== undefined) markRoot('language', language);
  // Dates and times take the regional form of the system, such as 24 hours in en-GB.
  const locale = localeOfArguments(process.argv);
  if (locale !== undefined) markRoot('locale', locale);
}

/** Sets a data attribute of the page's root element, as soon as the element exists. */
function markRoot(name: string, value: string): void {
  const root: HTMLElement | null = document.documentElement;
  if (root !== null) {
    root.dataset[name] = value;
    return;
  }
  const observer = new MutationObserver(() => {
    const element: HTMLElement | null = document.documentElement;
    if (element === null) return;
    observer.disconnect();
    element.dataset[name] = value;
  });
  observer.observe(document, { childList: true });
}
