import { describe, expect, it, vi } from 'vitest';
import { LaterCode } from '../modules/later-code.ts';

describe('LaterCode', () => {
  it('loads with its first call, which waits for it, as do the calls that come meanwhile', async () => {
    const load = Promise.withResolvers<{ name: string }>();
    const loads = vi.fn(() => load.promise);
    const code = new LaterCode(loads, () => undefined);
    const calls: string[] = [];
    expect(loads).not.toHaveBeenCalled();
    code.run((loaded) => calls.push(`first ${loaded.name}`));
    code.run((loaded) => calls.push(`second ${loaded.name}`));
    expect(loads).toHaveBeenCalledTimes(1);
    expect(code.loaded).toBeUndefined();
    await Promise.resolve();
    expect(calls).toEqual([]);
    load.resolve({ name: 'code' });
    await vi.waitFor(() => expect(calls).toEqual(['first code', 'second code']));
    expect(code.loaded).toEqual({ name: 'code' });
    // Once it is there, a call runs at once.
    code.run((loaded) => calls.push(`third ${loaded.name}`));
    expect(calls).toEqual(['first code', 'second code', 'third code']);
    expect(loads).toHaveBeenCalledTimes(1);
  });

  it('keeps the order of the calls that waiting calls make, before any later call', async () => {
    const load = Promise.withResolvers<string>();
    const code = new LaterCode(
      () => load.promise,
      () => undefined,
    );
    const calls: string[] = [];
    code.run(() => {
      calls.push('watch');
      // A call that a waiting call makes, such as a load that follows a view, comes after the
      // calls that waited before it.
      code.run(() => calls.push('nested'));
    });
    code.run(() => calls.push('start'));
    load.resolve('code');
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls).toEqual(['watch', 'start', 'nested']);
  });

  it('runs what the calls do without the code when it cannot load, and reports that once', async () => {
    const load = Promise.withResolvers<string>();
    const failed = vi.fn();
    const code = new LaterCode(() => load.promise, failed);
    const calls: string[] = [];
    code.run(
      () => calls.push('with'),
      () => calls.push('without'),
    );
    code.run(() => calls.push('only with'));
    load.reject(new Error('missing chunk'));
    await vi.waitFor(() => expect(calls).toEqual(['without']));
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(new Error('missing chunk'));
    // Later calls do not try again; they do without the code at once.
    code.run(
      () => calls.push('with'),
      () => calls.push('without again'),
    );
    expect(calls).toEqual(['without', 'without again']);
    expect(code.loaded).toBeUndefined();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('reports a waiting call that fails and still runs the calls after it', async () => {
    const load = Promise.withResolvers<string>();
    const failed = vi.fn();
    const code = new LaterCode(() => load.promise, failed);
    const calls: string[] = [];
    code.run(() => {
      throw new Error('broken call');
    });
    code.run(() => calls.push('after'));
    load.resolve('code');
    await vi.waitFor(() => expect(calls).toEqual(['after']));
    expect(failed).toHaveBeenCalledWith(new Error('broken call'));
    expect(code.loaded).toBe('code');
  });
});

describe('LaterCode.runInTurn', () => {
  it('runs a call that needs no code at once, or behind the calls that wait for the code', async () => {
    const load = Promise.withResolvers<string>();
    const code = new LaterCode(
      () => load.promise,
      () => undefined,
    );
    const calls: string[] = [];
    // Nothing waits: the call runs at once, and nothing loads.
    code.runInTurn(() => calls.push('new tab'));
    expect(calls).toEqual(['new tab']);
    // A command that needs the code waits, and one that comes after it waits behind it, as a
    // new tab after closing one must not be the tab that the close closes.
    code.run(() => calls.push('close'));
    code.runInTurn(() => calls.push('another new tab'));
    expect(calls).toEqual(['new tab']);
    load.resolve('code');
    await vi.waitFor(() => expect(calls).toEqual(['new tab', 'close', 'another new tab']));
    code.runInTurn(() => calls.push('last'));
    expect(calls).toHaveLength(4);
  });

  it('starts to load without a call, and runs the calls in their turn when the code cannot load', async () => {
    const load = Promise.withResolvers<string>();
    const loads = vi.fn(() => load.promise);
    const code = new LaterCode(loads, () => undefined);
    code.prepare();
    code.prepare();
    expect(loads).toHaveBeenCalledTimes(1);
    const calls: string[] = [];
    // Nothing waits for the code yet, so a call that needs none runs at once.
    code.runInTurn(() => calls.push('focus'));
    code.run(() => calls.push('close'));
    code.runInTurn(() => calls.push('new tab'));
    load.reject(new Error('missing chunk'));
    await vi.waitFor(() => expect(calls).toEqual(['focus', 'new tab']));
  });
});
