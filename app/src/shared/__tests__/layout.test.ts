import { describe, expect, it } from 'vitest';
import {
  layoutKeys,
  layoutPresetIds,
  layoutPresets,
  lockedPresets,
  presetOf,
} from '../layout-presets.ts';
import { tabStripPositions, toolbarPlacements } from '../layout.ts';

describe('layout presets', () => {
  it('sets the four settings of each preset, and none twice', () => {
    expect(layoutPresetIds).toEqual(['classic', 'compact', 'zen', 'vertical']);
    for (const id of layoutPresetIds) {
      expect(Object.keys(layoutPresets[id]).toSorted()).toEqual([...layoutKeys].toSorted());
      expect(tabStripPositions).toContain(layoutPresets[id]['tabs.position']);
      expect(toolbarPlacements).toContain(layoutPresets[id]['toolbar.placement']);
    }
    // No two presets set the same values.
    const values = layoutPresetIds.map((id) => JSON.stringify(layoutPresets[id]));
    expect(new Set(values).size).toBe(values.length);
  });

  it('recognizes each preset by its values, and none for other values', () => {
    for (const id of layoutPresetIds) expect(presetOf(layoutPresets[id])).toBe(id);
    // The defaults of the settings are Classic.
    expect(
      presetOf({
        'tabs.position': 'top',
        'toolbar.placement': 'own-row',
        'toolbar.autoHide': false,
        'appearance.density': 'normal',
      }),
    ).toBe('classic');
    expect(presetOf({ ...layoutPresets.compact, 'appearance.density': 'normal' })).toBe(undefined);
    expect(presetOf({ ...layoutPresets.vertical, 'tabs.position': 'right' })).toBe(undefined);
    expect(presetOf({})).toBe(undefined);
  });

  it('pays no heed to the other settings', () => {
    expect(presetOf({ ...layoutPresets.zen, 'appearance.titleBar': 'system', other: 1 })).toBe(
      'zen',
    );
  });

  it('keeps out the presets that would change a setting that a policy sets', () => {
    const values = { ...layoutPresets.classic, 'tabs.position': 'left' };
    // Nothing is locked: every preset can apply.
    expect(lockedPresets(values, () => false)).toEqual([]);
    // The tabs at the left by policy leave only Vertical.
    expect(lockedPresets(values, (key) => key === 'tabs.position')).toEqual([
      'classic',
      'compact',
      'zen',
    ]);
    // A density set by policy keeps out the presets of another density.
    expect(lockedPresets(layoutPresets.classic, (key) => key === 'appearance.density')).toEqual([
      'compact',
    ]);
  });
});
