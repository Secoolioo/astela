import { ipcMain, type WebContents } from 'electron';
import { activates, Activations } from '../../domain/navigation/popup-activation.ts';

/**
 * The inputs that people gave the web pages lately, which let each page open one window: the
 * pop-up blocker of the code for web pages uses them up (`popup-blocker.ts`). Electron runs no
 * pop-up blocker of its own and tells the window open handler nothing about a click, so the
 * browser process watches the input itself.
 */
export const pageActivations = new Activations<WebContents>(() => performance.now());

/** The pages whose input is followed; only their reports count. */
const followed = new WeakSet<WebContents>();

/** Whether the browser process listens to the reports of the frame preload. */
let listening = false;

/**
 * Follows the input that people give a web page: presses of the mouse in any of its frames, also
 * in the frames of other sites, touches and taps, which only its top frame reports, and the
 * clicks that its frames report with an activation and that no input event showed. Its keys
 * come from its window, which knows which of them it took as shortcuts (`web-pages.ts`). A new
 * document starts without the input of the one before, as in Chromium.
 * @param contents - The page.
 */
export function followActivation(contents: WebContents): void {
  followed.add(contents);
  if (!listening) {
    listening = true;
    // The frame preload reports a click that gave its page an activation, as the frame knows
    // it, such as the click of a screen reader, which no input event here shows.
    ipcMain.on('page.activation', (event) => {
      if (followed.has(event.sender)) pageActivations.activate(event.sender);
    });
  }
  const activate = (input: { readonly type: string }): void => {
    if (input.type !== 'keyDown' && activates(input)) pageActivations.activate(contents);
  };
  contents.on('before-mouse-event', (_event, mouse) => activate(mouse));
  contents.on('input-event', (_event, input) => activate(input));
  // The click that led to another document, such as that of a link in the same tab, lets the
  // new document open nothing.
  contents.on('did-navigate', () => pageActivations.clear(contents));
}
