import type { MessageBoxOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../kernel/events/emitter.ts';
import type { UpdateState } from '../../domain/updates/update-service.ts';
import type { BrowserWindowController } from '../../platform/electron/browser-window.ts';
import { showAbout, type AboutUpdates } from '../browser-menu.ts';
import { chooseLanguage } from '../ui-language.ts';

/** A box that About showed: what it said, and how it ends, as a person or the browser ends it. */
interface Box {
  readonly parent: unknown;
  readonly options: MessageBoxOptions;
  answer(response: number): void;
}

const { boxes } = vi.hoisted(() => ({ boxes: [] as Box[] }));

vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US', getName: () => 'Astela', getVersion: () => '0.7.4' },
  Menu: { buildFromTemplate: (template: unknown) => template },
  dialog: {
    // Like Electron's, a box stays until it is answered or its signal closes it.
    showMessageBox: (...args: unknown[]) =>
      new Promise((resolve) => {
        const options = (args.length > 1 ? args[1] : args[0]) as MessageBoxOptions;
        const answer = (response: number): void => resolve({ response, checkboxChecked: false });
        options.signal?.addEventListener('abort', () => answer(options.cancelId ?? 0));
        boxes.push({ parent: args.length > 1 ? args[0] : undefined, options, answer });
      }),
  },
}));

/** A window whose About shows on it. */
function window(): BrowserWindowController {
  const shown = { isDestroyed: () => false };
  return { window: shown } as unknown as BrowserWindowController;
}

/** Updates in a state that tests change, as the update controller tells them. */
function updatesIn(initial: UpdateState): AboutUpdates & {
  set(state: UpdateState): void;
  checks: number;
} {
  const changed = new Emitter<UpdateState>();
  let current = initial;
  const updates = {
    checks: 0,
    get state() {
      return current;
    },
    onDidChange: changed.event,
    check: () => {
      updates.checks += 1;
      updates.set({ kind: 'checking' });
      return new Promise<UpdateState>(() => undefined);
    },
    set: (state: UpdateState) => {
      current = state;
      changed.fire(state);
    },
  };
  return updates;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** The line of a box on the updates. */
const updateLine = (box: Box | undefined): string | undefined =>
  box?.options.detail?.split('\n')[0];

/** The button of About that checks for updates; macOS writes buttons in title case. */
const checkButton = process.platform === 'darwin' ? 'Check for Updates' : 'Check for updates';

describe('showAbout', () => {
  afterEach(() => {
    for (const box of boxes) box.answer(0);
    boxes.length = 0;
    chooseLanguage('system');
  });

  it('shows one About for each window, also when it is asked again', async () => {
    const first = window();
    const updates = updatesIn({ kind: 'idle' });
    showAbout(first, updates);
    showAbout(first, updates);
    expect(boxes).toHaveLength(1);
    showAbout(window(), updates);
    expect(boxes).toHaveLength(2);
    boxes[0]?.answer(0);
    await settle();
    showAbout(first, updates);
    expect(boxes).toHaveLength(3);
  });

  it('says at once that it checks, and shows the answer as soon as there is one', async () => {
    const shown = window();
    const updates = updatesIn({ kind: 'idle' });
    showAbout(shown, updates);
    expect(boxes[0]?.options.buttons).toEqual(['OK', checkButton]);
    boxes[0]?.answer(1);
    await settle();
    expect(updates.checks).toBe(1);
    expect(boxes).toHaveLength(2);
    expect(updateLine(boxes[1])).toBe('Checking for updates…');
    expect(boxes[1]?.options.buttons).toBeUndefined();
    // Asked again while it checks, the window keeps its one About.
    showAbout(shown, updates);
    expect(boxes).toHaveLength(2);
    updates.set({
      kind: 'failed',
      code: 'unavailable',
      message: 'updates/v1/index.json or its signature is missing',
      at: 0,
    });
    await settle();
    expect(boxes[1]?.options.signal?.aborted).toBe(true);
    expect(boxes).toHaveLength(3);
    expect(updateLine(boxes[2])).toBe(
      'The last check for updates failed. The update server did not send the update information.',
    );
    expect(boxes[2]?.options.buttons).toEqual(['OK', checkButton]);
  });

  it('tells why a check failed in the language of the browser, never the message of the error', () => {
    chooseLanguage('de');
    const reasons = ['expired', 'signature', 'no-artifact', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'];
    for (const code of reasons) {
      showAbout(window(), updatesIn({ kind: 'failed', code, message: 'English details', at: 0 }));
    }
    expect(boxes.map(updateLine)).toEqual([
      'Die letzte Suche nach Updates ist fehlgeschlagen. Die Update-Informationen sind veraltet.',
      'Die letzte Suche nach Updates ist fehlgeschlagen. Die Signatur der Update-Informationen ist ungültig.',
      'Die letzte Suche nach Updates ist fehlgeschlagen. Die neue Version hat kein Paket für dieses System.',
      'Die letzte Suche nach Updates ist fehlgeschlagen. Das Update konnte nicht geprüft oder geladen werden. Versuche es später noch einmal.',
    ]);
    expect(JSON.stringify(boxes.map((box) => box.options.detail))).not.toContain('English');
  });

  it('shows on its own without a window, once', () => {
    const updates = updatesIn({ kind: 'disabled', reason: 'policy' });
    showAbout(undefined, updates);
    showAbout(undefined, updates);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.parent).toBeUndefined();
    expect(updateLine(boxes[0])).toBe('Your organization turned off updates.');
  });
});
