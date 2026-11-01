import { ipcRenderer, webFrame } from 'electron';

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
}
