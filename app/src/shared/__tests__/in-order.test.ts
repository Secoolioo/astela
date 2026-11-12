import { describe, expect, it } from 'vitest';
import { inOrder } from '../in-order.ts';

/** A promise that the test settles itself. */
function deferred(): { promise: Promise<string>; settle: (value: string) => void } {
  const { promise, resolve } = Promise.withResolvers<string>();
  return { promise, settle: resolve };
}

describe('inOrder', () => {
  it('gives the results of a key in the order of the tasks, whatever each takes', async () => {
    const queue = inOrder();
    const page = {};
    const [slow, fast] = [deferred(), deferred()];
    const finished: string[] = [];
    const first = queue(page, () => slow.promise).then((name) => finished.push(name));
    const second = queue(page, () => fast.promise).then((name) => finished.push(name));
    // The later task is ready first, yet its result comes after the earlier one's.
    fast.settle('new');
    slow.settle('old');
    await Promise.all([first, second]);
    expect(finished).toEqual(['old', 'new']);
  });

  it('keeps keys apart, and goes on after a task that failed', async () => {
    const queue = inOrder();
    const [a, b] = [{}, {}];
    const failed = queue(a, () => Promise.reject(new Error('gone')));
    const after = queue(a, () => Promise.resolve('after'));
    const other = queue(b, () => Promise.resolve('other'));
    await expect(failed).rejects.toThrow('gone');
    await expect(after).resolves.toBe('after');
    await expect(other).resolves.toBe('other');
  });
});
