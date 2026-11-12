import type { Input } from 'electron';
import { describe, expect, it } from 'vitest';
import { shortcutTable } from '../../shared/shortcuts.ts';
import { commandForInput, type WindowCommand } from '../electron/shortcuts.ts';

/** A key press as `before-input-event` reports it. */
function press(key: string, details: Partial<Input> = {}): Input {
  return {
    type: 'keyDown',
    key,
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    location: 0,
    modifiers: [],
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...details,
  };
}

const ctrl = { control: true };
const ctrlShift = { control: true, shift: true };
const alt = { alt: true };
const cmd = { meta: true };
const cmdShift = { meta: true, shift: true };
const cmdOption = { meta: true, alt: true };

type Row = [label: string, input: Input, command: WindowCommand | undefined];

const windowsAndLinux: Row[] = [
  ['Ctrl+T', press('t', ctrl), 'tab.new'],
  ['Ctrl+W', press('w', ctrl), 'tab.close'],
  ['Ctrl+F4', press('F4', ctrl), 'tab.close'],
  ['Ctrl+Shift+T', press('T', ctrlShift), 'tab.reopen'],
  ['Ctrl+Tab', press('Tab', ctrl), 'tab.next'],
  ['Ctrl+Page Down', press('PageDown', ctrl), 'tab.next'],
  ['Ctrl+Shift+Tab', press('Tab', ctrlShift), 'tab.previous'],
  ['Ctrl+Page Up', press('PageUp', ctrl), 'tab.previous'],
  ['Ctrl+1', press('1', ctrl), 'tab.select1'],
  ['Ctrl+8', press('8', ctrl), 'tab.select8'],
  ['Ctrl+9', press('9', ctrl), 'tab.selectLast'],
  ['Ctrl+Shift+Page Up', press('PageUp', ctrlShift), 'tab.moveLeft'],
  ['Ctrl+Shift+Page Down', press('PageDown', ctrlShift), 'tab.moveRight'],
  ['Alt+Home', press('Home', alt), 'page.home'],
  ['F5', press('F5'), 'page.reload'],
  ['Ctrl+F5', press('F5', ctrl), 'page.reloadHard'],
  ['Shift+F5', press('F5', { shift: true }), 'page.reloadHard'],
  ['Ctrl+R', press('r', ctrl), 'page.reload'],
  ['Ctrl+Shift+R', press('R', ctrlShift), 'page.reloadHard'],
  ['Ctrl+F', press('f', ctrl), 'find.open'],
  ['F3', press('F3'), 'find.next'],
  ['Shift+F3', press('F3', { shift: true }), 'find.previous'],
  ['Ctrl+G', press('g', ctrl), 'find.next'],
  ['Ctrl+Shift+G', press('G', ctrlShift), 'find.previous'],
  ['Ctrl+=', press('=', ctrl), 'zoom.in'],
  ['Ctrl++ on the number pad', press('+', ctrl), 'zoom.in'],
  ['Ctrl+Shift+=, typing +', press('+', ctrlShift), 'zoom.in'],
  ['Ctrl+-', press('-', ctrl), 'zoom.out'],
  ['Ctrl+0', press('0', ctrl), 'zoom.reset'],
  ['Ctrl+0 on French, typing à', press('à', { ...ctrl, code: 'Digit0' }), 'zoom.reset'],
  // French types its only minus sign on the 6 key, so it keeps zooming out there.
  ['Ctrl+- on French, on the 6 key', press('-', { ...ctrl, code: 'Digit6' }), 'zoom.out'],
  ['Ctrl+1 on French, typing &', press('&', { ...ctrl, code: 'Digit1' }), 'tab.select1'],
  ['Ctrl+2 on French, typing é', press('é', { ...ctrl, code: 'Digit2' }), 'tab.select2'],
  ['Ctrl+3 on French, typing "', press('"', { ...ctrl, code: 'Digit3' }), 'tab.select3'],
  ["Ctrl+4 on French, typing '", press("'", { ...ctrl, code: 'Digit4' }), 'tab.select4'],
  ['Ctrl+5 on French, typing (', press('(', { ...ctrl, code: 'Digit5' }), 'tab.select5'],
  ['Ctrl+Shift+6 on French, typing 6', press('6', { ...ctrlShift, code: 'Digit6' }), 'tab.select6'],
  ['Ctrl+7 on French, typing è', press('è', { ...ctrl, code: 'Digit7' }), 'tab.select7'],
  ['Ctrl+8 on French, typing _', press('_', { ...ctrl, code: 'Digit8' }), 'tab.select8'],
  ['Ctrl+9 on French, typing ç', press('ç', { ...ctrl, code: 'Digit9' }), 'tab.selectLast'],
  ['Ctrl+Shift+1 on French, typing 1', press('1', { ...ctrlShift, code: 'Digit1' }), 'tab.select1'],
  ['Ctrl+= on French', press('=', { ...ctrl, code: 'Equal' }), 'zoom.in'],
  ['Ctrl+Shift+= on French, typing +', press('+', { ...ctrlShift, code: 'Equal' }), 'zoom.in'],
  ['Ctrl+6 on Belgian, typing §', press('§', { ...ctrl, code: 'Digit6' }), 'tab.select6'],
  ['Ctrl+8 on Belgian, typing !', press('!', { ...ctrl, code: 'Digit8' }), 'tab.select8'],
  ['Ctrl+- on Belgian, on a key of its own', press('-', { ...ctrl, code: 'Equal' }), 'zoom.out'],
  ['Ctrl+= on Belgian, on the key after :', press('=', { ...ctrl, code: 'Slash' }), 'zoom.in'],
  [
    'Ctrl+1 on Czech, typing +, not zooming in',
    press('+', { ...ctrl, code: 'Digit1' }),
    'tab.select1',
  ],
  ['Ctrl+2 on Czech, typing ě', press('ě', { ...ctrl, code: 'Digit2' }), 'tab.select2'],
  ['Ctrl+Shift+8 on Czech, typing 8', press('8', { ...ctrlShift, code: 'Digit8' }), 'tab.select8'],
  ['Ctrl+= on Czech, on the key after 0', press('=', { ...ctrl, code: 'Minus' }), 'zoom.in'],
  ['Ctrl+- on Czech, on the key after .', press('-', { ...ctrl, code: 'Slash' }), 'zoom.out'],
  ['Ctrl+0 on Czech, typing é', press('é', { ...ctrl, code: 'Digit0' }), 'zoom.reset'],
  ['Ctrl+1 on Slovak, typing +', press('+', { ...ctrl, code: 'Digit1' }), 'tab.select1'],
  ['Ctrl+5 on Slovak, typing ť', press('ť', { ...ctrl, code: 'Digit5' }), 'tab.select5'],
  ['Ctrl+Shift+= on English, typing +', press('+', { ...ctrlShift, code: 'Equal' }), 'zoom.in'],
  ['Ctrl++ on Swiss, Shift and the 1 key', press('+', { ...ctrlShift, code: 'Digit1' }), 'zoom.in'],
  ['no Ctrl+Shift+1 on English, typing !', press('!', { ...ctrlShift, code: 'Digit1' }), undefined],
  ['no AltGr+3 on French, typing #', press('#', { ...ctrl, ...alt, code: 'Digit3' }), undefined],
  ['no Alt+1 on French, typing &', press('&', { ...alt, code: 'Digit1' }), undefined],
  ['F11', press('F11'), 'window.fullscreen'],
  ['Ctrl+P', press('p', ctrl), 'page.print'],
  ['Ctrl+S', press('s', ctrl), 'page.save'],
  ['Ctrl+U', press('u', ctrl), 'page.source'],
  ['F12', press('F12'), 'devtools.toggle'],
  ['Ctrl+Shift+I', press('I', ctrlShift), 'devtools.toggle'],
  ['Alt+Left', press('ArrowLeft', alt), 'page.back'],
  ['Alt+Right', press('ArrowRight', alt), 'page.forward'],
  ['the Back key', press('BrowserBack'), 'page.back'],
  ['the Forward key', press('BrowserForward'), 'page.forward'],
  ['Ctrl+L', press('l', ctrl), 'omnibox.focus'],
  ['Alt+D', press('d', alt), 'omnibox.focus'],
  ['F6', press('F6'), 'omnibox.focus'],
  ['Ctrl+H', press('h', ctrl), 'history.open'],
  ['Ctrl+J', press('j', ctrl), 'downloads.open'],
  ['Ctrl+N', press('n', ctrl), 'window.new'],
  ['Ctrl+Shift+N', press('N', ctrlShift), 'window.newPrivate'],
  ['Ctrl+D', press('d', ctrl), 'bookmark.toggle'],
  ['Ctrl+Shift+O', press('O', ctrlShift), 'bookmarks.open'],
  ['Ctrl+Shift+B', press('B', ctrlShift), 'bookmarks.toggleBar'],
  ['Ctrl+T with Caps Lock', press('T', ctrl), 'tab.new'],
  ['Ctrl+T on a Cyrillic layout', press('е', { ...ctrl, code: 'KeyT' }), 'tab.new'],
  ['Ctrl+Shift+T on a Greek layout', press('Τ', { ...ctrlShift, code: 'KeyT' }), 'tab.reopen'],
  ['Ctrl+T on InScript, typing a vowel sign', press('ू', { ...ctrl, code: 'KeyT' }), 'tab.new'],
  ['Alt+D on InScript, typing the virama', press('्', { ...alt, code: 'KeyD' }), 'omnibox.focus'],
  ['Ctrl+W on AZERTY, where W is on the Z key', press('w', { ...ctrl, code: 'KeyZ' }), 'tab.close'],
  [
    'no Ctrl+Z on AZERTY, where Z is on the W key',
    press('z', { ...ctrl, code: 'KeyW' }),
    undefined,
  ],
  ['no AltGr+T, reported as Ctrl+Alt+T', press('t', { ...ctrl, ...alt, code: 'KeyT' }), undefined],
  ['no AltGr+Q typing @', press('@', { ...ctrl, ...alt, code: 'KeyQ' }), undefined],
  ['no AltGr+D typing Đ', press('Đ', { ...ctrl, ...alt, code: 'KeyD' }), undefined],
  ['no AltGr+L typing ł', press('ł', { ...ctrl, ...alt, code: 'KeyL' }), undefined],
  ['no AltGr+Left', press('ArrowLeft', { ...ctrl, ...alt }), undefined],
  ['no AltGr+Tab', press('Tab', { ...ctrl, ...alt }), undefined],
  ['no AltGr+F5', press('F5', { ...ctrl, ...alt }), undefined],
  ['no Ctrl+Left, which moves by word', press('ArrowLeft', ctrl), undefined],
  ['no Shift+Alt+Left', press('ArrowLeft', { ...alt, shift: true }), undefined],
  ['no Alt+F4, which closes the window', press('F4', alt), undefined],
  ['no Shift+F6', press('F6', { shift: true }), undefined],
  ['no Shift+Alt+D', press('D', { ...alt, shift: true }), undefined],
  ['no Windows key+T', press('t', cmd), undefined],
  ['no Ctrl+Windows key+T', press('t', { ...ctrl, ...cmd }), undefined],
  ['no Windows key+Left', press('ArrowLeft', cmd), undefined],
  ['no Windows key+[, which goes back on macOS', press('[', cmd), undefined],
  ['no T alone', press('t'), undefined],
];

const macOS: Row[] = [
  ['Cmd+T', press('t', cmd), 'tab.new'],
  ['Cmd+W', press('w', cmd), 'tab.close'],
  ['Cmd+Shift+T', press('T', cmdShift), 'tab.reopen'],
  ['Ctrl+Tab', press('Tab', ctrl), 'tab.next'],
  ['Ctrl+Shift+Tab', press('Tab', ctrlShift), 'tab.previous'],
  ['Cmd+Option+Right', press('ArrowRight', cmdOption), 'tab.next'],
  ['Cmd+Option+Left', press('ArrowLeft', cmdOption), 'tab.previous'],
  ['Cmd+Shift+], typing }', press('}', { ...cmdShift, code: 'BracketRight' }), 'tab.next'],
  ['Cmd+Shift+[, typing {', press('{', { ...cmdShift, code: 'BracketLeft' }), 'tab.previous'],
  ['Cmd+Shift+], reported as ]', press(']', { ...cmdShift, code: 'BracketRight' }), 'tab.next'],
  ['Cmd+1', press('1', cmd), 'tab.select1'],
  ['Cmd+9', press('9', cmd), 'tab.selectLast'],
  ['Cmd+R', press('r', cmd), 'page.reload'],
  ['Cmd+Shift+H', press('H', cmdShift), 'page.home'],
  ['Cmd+Shift+R', press('R', cmdShift), 'page.reloadHard'],
  ['Cmd+F', press('f', cmd), 'find.open'],
  ['Cmd+G', press('g', cmd), 'find.next'],
  ['Cmd+Shift+G', press('G', cmdShift), 'find.previous'],
  ['Cmd+=', press('=', cmd), 'zoom.in'],
  ['Cmd+-', press('-', cmd), 'zoom.out'],
  ['Cmd+0', press('0', cmd), 'zoom.reset'],
  ['Cmd+0 on French, typing à', press('à', { ...cmd, code: 'Digit0' }), 'zoom.reset'],
  ['Cmd+1 on French, typing &', press('&', { ...cmd, code: 'Digit1' }), 'tab.select1'],
  ['Cmd+3 on French, typing "', press('"', { ...cmd, code: 'Digit3' }), 'tab.select3'],
  ['Cmd+6 on French, typing §', press('§', { ...cmd, code: 'Digit6' }), 'tab.select6'],
  ['Cmd+8 on French, typing !', press('!', { ...cmd, code: 'Digit8' }), 'tab.select8'],
  ['Cmd+9 on French, typing ç', press('ç', { ...cmd, code: 'Digit9' }), 'tab.selectLast'],
  ['Cmd+Shift+5 on French, typing 5', press('5', { ...cmdShift, code: 'Digit5' }), 'tab.select5'],
  ['Cmd+- on French, on a key of its own', press('-', { ...cmd, code: 'Equal' }), 'zoom.out'],
  ['Cmd+= on French, on the key after :', press('=', { ...cmd, code: 'Slash' }), 'zoom.in'],
  [
    'Cmd+1 on Czech, typing +, not zooming in',
    press('+', { ...cmd, code: 'Digit1' }),
    'tab.select1',
  ],
  ['Cmd+= on Czech, on the key after 0', press('=', { ...cmd, code: 'Minus' }), 'zoom.in'],
  ['Ctrl+Cmd+F', press('f', { ...ctrl, ...cmd }), 'window.fullscreen'],
  ['Cmd+P', press('p', cmd), 'page.print'],
  ['Cmd+S', press('s', cmd), 'page.save'],
  ['Cmd+Option+U', press('u', cmdOption), 'page.source'],
  ['Cmd+Option+I', press('i', cmdOption), 'devtools.toggle'],
  ['Cmd+[', press('[', { ...cmd, code: 'BracketLeft' }), 'page.back'],
  ['Cmd+]', press(']', { ...cmd, code: 'BracketRight' }), 'page.forward'],
  ['Cmd+L', press('l', cmd), 'omnibox.focus'],
  ['Cmd+Y', press('y', cmd), 'history.open'],
  ['Alt+Cmd+L', press('l', cmdOption), 'downloads.open'],
  ['Cmd+N', press('n', cmd), 'window.new'],
  ['Cmd+Shift+N', press('N', cmdShift), 'window.newPrivate'],
  ['Cmd+D', press('d', cmd), 'bookmark.toggle'],
  ['Cmd+Shift+O', press('O', cmdShift), 'bookmarks.open'],
  ['Cmd+Shift+B', press('B', cmdShift), 'bookmarks.toggleBar'],
  ['Cmd+[ where [ needs Option', press('[', { ...cmdOption, code: 'Digit5' }), 'page.back'],
  ['Cmd+] where ] needs Option+Shift', press(']', { ...cmdOption, shift: true }), 'page.forward'],
  ['Cmd+{ where { needs Option', press('{', { ...cmdOption, code: 'Digit8' }), 'tab.previous'],
  ['Cmd+T on a Cyrillic layout', press('е', { ...cmd, code: 'KeyT' }), 'tab.new'],
  ['Cmd+[ on Russian, typing х', press('х', { ...cmd, code: 'BracketLeft' }), 'page.back'],
  ['Cmd+] on Russian, typing ъ', press('ъ', { ...cmd, code: 'BracketRight' }), 'page.forward'],
  ['Cmd+Shift+] on Russian', press('Ъ', { ...cmdShift, code: 'BracketRight' }), 'tab.next'],
  ['Cmd+[ on Arabic, typing ج', press('ج', { ...cmd, code: 'BracketLeft' }), 'page.back'],
  ['Cmd+] on InScript, a nukta', press('़', { ...cmd, code: 'BracketRight' }), 'page.forward'],
  ['no Cmd+Option+[ on Russian', press('х', { ...cmdOption, code: 'BracketLeft' }), undefined],
  ['no Cmd+ü on German, on the [ key', press('ü', { ...cmd, code: 'BracketLeft' }), undefined],
  [
    'Cmd++ on German zooms in, not forward, on the ] key',
    press('+', { ...cmd, code: 'BracketRight' }),
    'zoom.in',
  ],
  ['no Cmd+Left, which moves the caret', press('ArrowLeft', cmd), undefined],
  ['no Cmd+Right, which moves the caret', press('ArrowRight', cmd), undefined],
  ['no Cmd+Shift+Left, which selects', press('ArrowLeft', cmdShift), undefined],
  ['no Option+Left, which moves by word', press('ArrowLeft', alt), undefined],
  ['no Cmd+Tab, the app switcher', press('Tab', cmd), undefined],
  ['no Cmd+Shift+Tab', press('Tab', cmdShift), undefined],
  ['no Cmd+Option+[ typing “', press('“', { ...cmdOption, code: 'BracketLeft' }), undefined],
  ['no Ctrl+T', press('t', ctrl), undefined],
  ['no Ctrl+Cmd+T', press('t', { ...ctrl, ...cmd }), undefined],
  ['no Ctrl+[', press('[', ctrl), undefined],
  ['no F5', press('F5'), undefined],
  ['no F6', press('F6'), undefined],
  ['no Option+D typing ∂', press('∂', { ...alt, code: 'KeyD' }), undefined],
  // Option types another character on a letter key, or starts an accent.
  [
    'Cmd+Option+I, starting an accent',
    press('Dead', { ...cmdOption, code: 'KeyI' }),
    'devtools.toggle',
  ],
  [
    'Cmd+Option+U, starting an accent',
    press('Dead', { ...cmdOption, code: 'KeyU' }),
    'page.source',
  ],
  ['Cmd+Option+L, typing ¬', press('¬', { ...cmdOption, code: 'KeyL' }), 'downloads.open'],
  [
    'Cmd+Option+L on German, typing @',
    press('@', { ...cmdOption, code: 'KeyL' }),
    'downloads.open',
  ],
  ['no Cmd+Option+D typing ∂', press('∂', { ...cmdOption, code: 'KeyD' }), undefined],
  ['no Option+Right, which moves by word', press('ArrowRight', alt), undefined],
];

describe.each(['win32', 'linux'])('commandForInput on %s', (platform) => {
  it.each(windowsAndLinux)('%s', (_label, input, command) => {
    expect(commandForInput(input, platform)).toBe(command);
  });
});

describe('commandForInput on darwin', () => {
  it.each(macOS)('%s', (_label, input, command) => {
    expect(commandForInput(input, 'darwin')).toBe(command);
  });
});

describe.each(['darwin', 'win32', 'linux'])('commandForInput on %s', (platform) => {
  const newTab = press('t', platform === 'darwin' ? cmd : ctrl);

  it('acts on the key press, not on its release', () => {
    expect(commandForInput(newTab, platform)).toBe('tab.new');
    expect(commandForInput({ ...newTab, type: 'keyUp' }, platform)).toBeUndefined();
  });

  it('leaves keys to an input method that composes text', () => {
    expect(commandForInput({ ...newTab, isComposing: true }, platform)).toBeUndefined();
    expect(commandForInput(press('F6', { isComposing: true }), platform)).toBeUndefined();
    expect(commandForInput(press('Process', { isComposing: true }), platform)).toBeUndefined();
  });
});

describe.each(['darwin', 'win32', 'linux'])('commands of the menus on %s', (platform) => {
  const keys = press('Y', platform === 'darwin' ? cmdShift : ctrlShift);
  const own = platform === 'darwin' ? 'Shift+Cmd+Y' : 'Ctrl+Shift+Y';

  it('run only with a shortcut that people gave them', () => {
    expect(commandForInput(keys, platform)).toBeUndefined();
    for (const command of ['tab.duplicate', 'tab.mute', 'app.about'] as const) {
      const table = shortcutTable(platform, { [command]: [own] });
      expect(commandForInput(keys, platform, table)).toBe(command);
    }
  });
});
