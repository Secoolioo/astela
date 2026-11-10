import { ipcRenderer, webFrame } from 'electron';
import { privateWindowArgument } from '../shared/private-window.ts';

/**
 * Applies the browser's accent and density to the page before its first paint, and again
 * whenever they change. The style sheet comes from the browser process, on the command line
 * at start and as an event later; the page itself never sees or handles it.
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
  if (process.argv.includes(privateWindowArgument)) markPrivate();
}

/** Marks the page as one of a private window, as soon as its root element exists. */
function markPrivate(): void {
  if (markRoot()) return;
  const observer = new MutationObserver(() => {
    if (markRoot()) observer.disconnect();
  });
  observer.observe(document, { childList: true });
}

/** Marks the root element; `false` while the page has none yet. */
function markRoot(): boolean {
  const root: HTMLElement | null = document.documentElement;
  if (root === null) return false;
  root.dataset['private'] = '';
  return true;
}
