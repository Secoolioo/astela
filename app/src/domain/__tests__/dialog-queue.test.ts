import { describe, expect, it } from 'vitest';
import { DialogQueue } from '../dialogs/dialog-queue.ts';

/** A page of a tab, and the answers that it got, in their order. */
function page(): {
  answers: string[];
  answer: (name: string) => (ok: boolean, value: string) => void;
} {
  const answers: string[] = [];
  return {
    answers,
    answer: (name) => (ok, value) => answers.push(`${name}:${ok ? 'ok' : 'cancel'}:${value}`),
  };
}

describe('DialogQueue', () => {
  it('keeps the dialogs of each page apart, in the order that they came', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    const two = page();
    const a = queue.add(
      one,
      { frame: 'f1', origin: 'https://a.example', detail: 'a' },
      one.answer('a'),
    );
    const b = queue.add(
      two,
      { frame: 'f2', origin: 'https://b.example', detail: 'b' },
      two.answer('b'),
    );
    const c = queue.add(
      one,
      { frame: 'f3', origin: 'https://c.example', detail: 'c' },
      one.answer('c'),
    );
    expect(queue.first(one)?.id).toBe(a?.id);
    expect(queue.first(two)?.id).toBe(b?.id);
    expect(queue.waits(one) && queue.waits(two)).toBe(true);
    expect(queue.asks(one) && queue.asks(two)).toBe(true);
    // An answer names its dialog and its page; another page's dialog does not take it.
    expect(queue.answer(two, a?.id ?? -1, true, '', false)).toBe(false);
    expect(queue.answer(one, a?.id ?? -1, true, 'x', false)).toBe(true);
    expect(queue.answer(one, a?.id ?? -1, true, 'x', false)).toBe(false);
    expect(queue.first(one)?.id).toBe(c?.id);
    expect(one.answers).toEqual(['a:ok:x']);
    expect(two.answers).toEqual([]);
  });

  it('answers with Cancel when the page loads another document, closes or crashes', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: 'a' }, one.answer('a'));
    queue.add(one, { frame: 'f2', origin: 'https://a.example', detail: 'b' }, one.answer('b'));
    expect(queue.cancel(one)).toBe(true);
    expect(queue.cancel(one)).toBe(false);
    expect(one.answers).toEqual(['a:cancel:', 'b:cancel:']);
    expect(queue.waits(one)).toBe(false);
    queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: 'c' }, one.answer('c'));
    expect(queue.newDocument(one)).toBe(true);
    expect(queue.newDocument(one)).toBe(false);
    expect(one.answers.at(-1)).toBe('c:cancel:');
  });

  it('offers to stop a page from its second dialog in a document, and then cancels at once', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    const first = queue.add(
      one,
      { frame: 'f1', origin: 'https://a.example', detail: '1' },
      one.answer('1'),
    );
    expect(first?.offersStop).toBe(false);
    // A question that did not offer it stops nothing.
    queue.answer(one, first?.id ?? -1, true, '', true);
    const second = queue.add(
      one,
      { frame: 'f1', origin: 'https://a.example', detail: '2' },
      one.answer('2'),
    );
    expect(second?.offersStop).toBe(true);
    queue.answer(one, second?.id ?? -1, true, '', true);
    expect(
      queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: '3' }, one.answer('3')),
    ).toBeUndefined();
    // The stop holds for the embedded pages of the page as well.
    expect(
      queue.add(one, { frame: 'f2', origin: 'https://b.example', detail: 'b' }, one.answer('b')),
    ).toBeUndefined();
    expect(one.answers).toEqual(['1:ok:', '2:ok:', '3:cancel:', 'b:cancel:']);
    // Another page still asks.
    const two = page();
    expect(
      queue.add(two, { frame: 'f1', origin: 'https://a.example', detail: 'x' }, two.answer('x')),
    ).toBeDefined();
    // A new document asks again from the start.
    queue.newDocument(one);
    expect(
      queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: '4' }, one.answer('4'))
        ?.offersStop,
    ).toBe(false);
  });

  it('counts the dialogs of every frame of a page, also when each comes from another origin', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    const offers = [1, 2, 3].map((n) => {
      const dialog = queue.add(
        one,
        { frame: `f${String(n)}`, origin: `https://r${String(n)}.example`, detail: String(n) },
        one.answer(String(n)),
      );
      queue.answer(one, dialog?.id ?? -1, true, '', true);
      return dialog?.offersStop;
    });
    expect(offers).toEqual([false, true, undefined]);
    expect(one.answers).toEqual(['1:ok:', '2:ok:', '3:cancel:']);
  });

  it('keeps an alert that had its answer to show it, without holding the page, until the next dialog', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    const shown = queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: 'a' });
    expect(shown?.waits).toBe(false);
    expect(queue.asks(one)).toBe(true);
    expect(queue.waits(one)).toBe(false);
    // The next alert of the page takes its place, and counts.
    const next = queue.add(one, { frame: 'f2', origin: 'https://a.example', detail: 'b' });
    expect(queue.first(one)?.id).toBe(next?.id);
    expect(next?.offersStop).toBe(true);
    // A dialog that waits takes its place as well.
    const waiting = queue.add(
      one,
      { frame: 'f3', origin: 'https://a.example', detail: 'c' },
      one.answer('c'),
    );
    expect(queue.first(one)?.id).toBe(waiting?.id);
    expect(queue.waits(one)).toBe(true);
    expect(queue.answer(one, waiting?.id ?? -1, true, '', true)).toBe(true);
    expect(queue.asks(one)).toBe(false);
    // Once the page's dialogs are stopped, nothing shows of them.
    expect(
      queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: 'd' }),
    ).toBeUndefined();
    expect(one.answers).toEqual(['c:ok:']);
  });

  it('drops the question of a frame that asks again, which had its answer elsewhere', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    const old = queue.add(
      one,
      { frame: 'f1', origin: 'https://a.example', detail: 'old' },
      one.answer('old'),
    );
    const other = queue.add(
      one,
      { frame: 'f2', origin: 'https://a.example', detail: 'other' },
      one.answer('other'),
    );
    const again = queue.add(
      one,
      { frame: 'f1', origin: 'https://a.example', detail: 'again' },
      one.answer('again'),
    );
    expect(one.answers).toEqual(['old:cancel:']);
    expect(queue.first(one)?.id).toBe(other?.id);
    expect(queue.answer(one, old?.id ?? -1, true, '', false)).toBe(false);
    expect(queue.answer(one, other?.id ?? -1, false, '', false)).toBe(true);
    expect(queue.first(one)?.id).toBe(again?.id);
  });

  it('stops the waiting dialogs of the page with the answer that stops it', () => {
    const queue = new DialogQueue<object, string>();
    const one = page();
    queue.add(one, { frame: 'f1', origin: 'https://a.example', detail: '1' }, one.answer('1'));
    const second = queue.add(
      one,
      { frame: 'f2', origin: 'https://a.example', detail: '2' },
      one.answer('2'),
    );
    queue.add(one, { frame: 'f3', origin: 'https://a.example', detail: '3' }, one.answer('3'));
    queue.add(one, { frame: 'f4', origin: 'https://b.example', detail: 'b' }, one.answer('b'));
    queue.answer(one, queue.first(one)?.id ?? -1, true, '', false);
    queue.answer(one, second?.id ?? -1, false, '', true);
    expect(one.answers).toEqual(['1:ok:', '3:cancel:', 'b:cancel:', '2:cancel:']);
    expect(queue.asks(one)).toBe(false);
  });
});
