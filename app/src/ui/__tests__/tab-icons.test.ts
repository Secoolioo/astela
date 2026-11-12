import { describe, expect, it } from 'vitest';
import { TabIcons } from '../shell/tab-icons.ts';

/** A browser that answers the questions for icons when the test says so. */
function browser(): {
  readonly asked: string[];
  readonly answer: (index: number, icon: string | null) => void;
  readonly fail: (index: number) => void;
  readonly ask: (key: string) => Promise<string | null>;
} {
  const asked: string[] = [];
  const answers: { resolve: (icon: string | null) => void; reject: (error: Error) => void }[] = [];
  return {
    asked,
    answer: (index, icon) => answers[index]?.resolve(icon),
    fail: (index) => answers[index]?.reject(new Error('The window closed')),
    ask: (key) =>
      new Promise((resolve, reject) => {
        asked.push(key);
        answers.push({ resolve, reject });
      }),
  };
}

/** Waits until the answers that came have been handled. */
function settled(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

describe('TabIcons', () => {
  it('asks once for the icon of a key and shows it when it arrives', async () => {
    const icons = browser();
    let arrived = 0;
    const tabs = new TabIcons(icons.ask, () => (arrived += 1));
    expect(tabs.get('a')).toBeUndefined();
    expect(tabs.get('a')).toBeUndefined();
    expect(icons.asked).toEqual(['a']);
    icons.answer(0, 'data:image/png;base64,AA==');
    await settled();
    expect(arrived).toBe(1);
    expect(tabs.get('a')).toBe('data:image/png;base64,AA==');
    expect(icons.asked).toEqual(['a']);
  });

  it('keeps only the icons that tabs show, also when an answer comes late', async () => {
    const icons = browser();
    let arrived = 0;
    const tabs = new TabIcons(icons.ask, () => (arrived += 1));
    tabs.get('a');
    tabs.get('b');
    icons.answer(0, 'data:image/png;base64,AA==');
    await settled();
    tabs.keep(['b']);
    // The answer for a key that no tab shows any more is not kept.
    icons.answer(1, 'data:image/png;base64,BB==');
    tabs.keep([]);
    await settled();
    expect(arrived).toBe(1);
    // A tab that shows a key again asks for it again.
    expect(tabs.get('a')).toBeUndefined();
    expect(tabs.get('b')).toBeUndefined();
    expect(icons.asked).toEqual(['a', 'b', 'a', 'b']);
  });

  it('asks again for a key that the browser had no icon for, or whose question failed', async () => {
    const icons = browser();
    const tabs = new TabIcons(icons.ask, () => undefined);
    tabs.get('a');
    tabs.get('b');
    icons.answer(0, null);
    icons.fail(1);
    await settled();
    tabs.get('a');
    tabs.get('b');
    expect(icons.asked).toEqual(['a', 'b', 'a', 'b']);
  });
});
