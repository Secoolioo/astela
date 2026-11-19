import type { TabStripPosition, ToolbarPlacement } from './layout.ts';

// The layout presets of the settings page and the setup guide. A preset is no setting of its
// own: it sets four settings at once, and the page recognizes it by their values, so people
// can change each of them afterwards. Only the pages and the handler that applies a preset
// load this file, not the start of the browser.

/** The layout presets, in the order of the settings page. */
export const layoutPresetIds = ['classic', 'compact', 'zen', 'vertical'] as const;

/** A layout preset. */
export type LayoutPresetId = (typeof layoutPresetIds)[number];

/** The settings that a layout preset sets, in their order. */
export const layoutKeys = [
  'tabs.position',
  'toolbar.placement',
  'toolbar.autoHide',
  'appearance.density',
] as const;

/** A setting that a layout preset sets. */
export type LayoutKey = (typeof layoutKeys)[number];

/**
 * The values of the settings of a preset. The densities are written out here, as the shared
 * code cannot use those of the domain; a test checks them against the schemas of the settings.
 */
export type LayoutValues = {
  readonly 'tabs.position': TabStripPosition;
  readonly 'toolbar.placement': ToolbarPlacement;
  readonly 'toolbar.autoHide': boolean;
  readonly 'appearance.density': 'compact' | 'normal' | 'comfortable';
};

/**
 * The presets: Classic with the tabs above the address bar, Compact with both in one row and
 * less space, Zen with that row hidden until it is needed, and Vertical with the tabs as a list
 * at the left. None touches the title bar, which takes effect only after a restart.
 */
export const layoutPresets: Readonly<Record<LayoutPresetId, LayoutValues>> = {
  classic: {
    'tabs.position': 'top',
    'toolbar.placement': 'own-row',
    'toolbar.autoHide': false,
    'appearance.density': 'normal',
  },
  compact: {
    'tabs.position': 'top',
    'toolbar.placement': 'tab-row',
    'toolbar.autoHide': false,
    'appearance.density': 'compact',
  },
  zen: {
    'tabs.position': 'top',
    'toolbar.placement': 'tab-row',
    'toolbar.autoHide': true,
    'appearance.density': 'normal',
  },
  vertical: {
    'tabs.position': 'left',
    'toolbar.placement': 'own-row',
    'toolbar.autoHide': false,
    'appearance.density': 'normal',
  },
};

/**
 * The preset whose four values the settings have, or `undefined` for an arrangement of one's
 * own. Other settings do not count.
 * @param values - The values of the settings, by their keys.
 */
export function presetOf(values: Readonly<Record<string, unknown>>): LayoutPresetId | undefined {
  return layoutPresetIds.find((id) =>
    layoutKeys.every((key) => values[key] === layoutPresets[id][key]),
  );
}

/**
 * The presets that would change a setting that a mandatory policy sets: applying one would
 * leave that setting as it is, so the pages offer it disabled.
 * @param values - The values of the settings, by their keys.
 * @param locked - Whether a mandatory policy sets a setting.
 */
export function lockedPresets(
  values: Readonly<Record<string, unknown>>,
  locked: (key: LayoutKey) => boolean,
): LayoutPresetId[] {
  return layoutPresetIds.filter((id) =>
    layoutKeys.some((key) => locked(key) && values[key] !== layoutPresets[id][key]),
  );
}
