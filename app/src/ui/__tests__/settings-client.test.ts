import { describe, expect, it, vi } from 'vitest';
import { SettingsClient, paintSwatches, type PageBridge } from '../ui-kit/settings-client.ts';

function bridge(): PageBridge & { emit(payload: unknown): void; calls: unknown[][] } {
  let listener: ((payload: unknown) => void) | undefined;
  const calls: unknown[][] = [];
  return {
    calls,
    emit: (payload) => listener?.(payload),
    invoke: (channel, payload) => {
      calls.push([channel, payload]);
      if (channel === 'settings.getAll') {
        return Promise.resolve({
          settings: [{ key: 'appearance.accent', value: 'blue', locked: false }, { bad: 1 }],
          accents: [{ id: 'blue', light: 'L', dark: 'D' }, { id: 7 }],
        });
      }
      return Promise.resolve({ ok: payload !== null && typeof payload === 'object' });
    },
    on: (_channel, fn) => {
      listener = fn;
      return () => (listener = undefined);
    },
  };
}

describe('SettingsClient', () => {
  it('loads, follows changes and writes settings', async () => {
    const page = bridge();
    const onChange = vi.fn();
    const client = new SettingsClient(page, onChange);
    await client.load();
    expect(client.get('appearance.accent')?.value).toBe('blue');
    expect(client.accents).toEqual([{ id: 'blue', light: 'L', dark: 'D' }]);
    page.emit({ settings: [{ key: 'appearance.accent', value: 'red', locked: true }] });
    expect(client.get('appearance.accent')).toEqual({
      key: 'appearance.accent',
      value: 'red',
      locked: true,
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(await client.set('appearance.accent', 'green')).toBe(true);
    expect(page.calls.at(-1)).toEqual([
      'settings.set',
      { key: 'appearance.accent', value: 'green' },
    ]);
    client.dispose();
    page.emit({ settings: [{ key: 'appearance.accent', value: 'teal', locked: false }] });
    expect(client.get('appearance.accent')?.value).toBe('red');
  });

  it('paints swatches through the style object of each element', () => {
    const style = { setProperty: vi.fn() };
    const root = { querySelectorAll: () => [{ style }] } as unknown as ParentNode;
    paintSwatches(root, [{ id: 'blue', light: 'L', dark: 'D' }]);
    expect(style.setProperty).toHaveBeenCalledWith('--swatch-light', 'L');
    expect(style.setProperty).toHaveBeenCalledWith('--swatch-dark', 'D');
  });
});
