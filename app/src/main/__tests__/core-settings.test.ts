import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import type { PolicyLevel, PolicyProvider, PolicyReadResult } from '../../domain/policy/policy.ts';
import { PolicyService } from '../../domain/policy/policy-service.ts';
import { sessionStart } from '../../domain/session/session.ts';
import { SettingsService, settingPolicies } from '../../domain/settings/settings-service.ts';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import {
  AltOpensMenuSetting,
  CommandPaletteSetting,
  coreSettings,
  DownloadFolderSetting,
  PictureInPictureEnabledSetting,
  ReaderEnabledSetting,
  ReaderFontSetting,
  ShortcutsSetting,
  SplitViewSetting,
  StartupSetting,
  TabSleepAfterSetting,
  TabSleepSetting,
  TabStripPositionSetting,
  DensitySetting,
  ToolbarAutoHideSetting,
  ToolbarPlacementSetting,
  WorkspacesEnabledSetting,
  WorkspacesRemovedSetting,
  WorkspacesSetting,
} from '../core-settings.ts';
import { sleepAfterSeconds } from '../../shared/tab-sleep.ts';
import { layoutKeys, layoutPresetIds, layoutPresets } from '../../shared/layout-presets.ts';

/** Whether the setting takes a folder. */
const valid = (folder: string): boolean =>
  v.safeParse(DownloadFolderSetting.schema, folder).success;

describe('DownloadFolderSetting', () => {
  it('takes an absolute folder or none, and refuses a relative path', () => {
    expect(valid('')).toBe(true);
    expect(valid(process.platform === 'win32' ? 'D:\\Downloads' : '/srv/downloads')).toBe(true);
    // Chromium's variables are not replaced, so they would make a relative path.
    expect(valid('${user_home}/Downloads')).toBe(false);
    expect(valid('Downloads')).toBe(false);
  });
});

/** Whether the setting takes shortcuts of people's own. */
const takes = (overrides: unknown): boolean =>
  v.safeParse(ShortcutsSetting.schema, overrides).success;

describe('ShortcutsSetting', () => {
  const mac = process.platform === 'darwin';

  it('takes shortcuts of their own for the commands of the menus', () => {
    const own = mac ? 'Shift+Cmd+Y' : 'Ctrl+Shift+Y';
    for (const command of [
      'tab.duplicate',
      'tab.closeOthers',
      'tab.closeRight',
      'tab.mute',
      'app.about',
      'app.quit',
    ]) {
      expect({ command, valid: takes({ [command]: [own] }) }).toEqual({ command, valid: true });
    }
  });

  it('takes shortcuts of their own for the command palette and tab search', () => {
    expect(takes({ 'palette.open': [mac ? 'Shift+Cmd+P' : 'Ctrl+Shift+P'] })).toBe(true);
    expect(takes({ 'tabs.search': [] })).toBe(true);
  });

  it('refuses the keys of the system and unknown commands', () => {
    expect(takes({ 'app.quit': [mac ? 'Cmd+Q' : 'Alt+F4'] })).toBe(false);
    expect(takes({ 'app.restart': ['F9'] })).toBe(false);
  });
});

describe('AltOpensMenuSetting', () => {
  it('opens the menu with Alt by default, as a keyboard preference without a policy', () => {
    expect(AltOpensMenuSetting).toMatchObject({ key: 'keys.altOpensMenu', default: true });
    expect(AltOpensMenuSetting.policy).toBeUndefined();
    expect(v.safeParse(AltOpensMenuSetting.schema, false).success).toBe(true);
    expect(v.safeParse(AltOpensMenuSetting.schema, 'no').success).toBe(false);
  });

  it.each(['win32', 'linux', 'darwin'])(
    'has a place on the settings page on %s only off macOS',
    async (platform) => {
      const real = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        vi.resetModules();
        const { AltOpensMenuSetting: setting } = await import('../core-settings.ts');
        expect(setting.ui).toEqual(
          platform === 'darwin' ? undefined : { section: 'shortcuts', control: 'toggle', order: 2 },
        );
      } finally {
        if (real !== undefined) Object.defineProperty(process, 'platform', real);
      }
    },
  );
});

describe('CommandPaletteSetting', () => {
  it('turns the palette on by default, and a policy can set or recommend it', () => {
    expect(CommandPaletteSetting).toMatchObject({
      key: 'commandPalette.enabled',
      default: true,
      policy: { name: 'CommandPaletteEnabled', recommended: true },
      ui: { section: 'shortcuts', control: 'toggle', order: 0 },
    });
    expect(coreSettings).toContain(CommandPaletteSetting);
    expect(settingPolicies(coreSettings).map((policy) => policy.name)).toContain(
      'CommandPaletteEnabled',
    );
    expect(v.safeParse(CommandPaletteSetting.schema, false).success).toBe(true);
    expect(v.safeParse(CommandPaletteSetting.schema, 'off').success).toBe(false);
  });
});

describe('SplitViewSetting', () => {
  it('turns split view on by default, and a policy can set or recommend it', () => {
    expect(SplitViewSetting).toMatchObject({
      key: 'splitView.enabled',
      default: true,
      scope: 'global',
      policy: { name: 'SplitViewEnabled', recommended: true },
      ui: { section: 'appearance', control: 'toggle' },
    });
    expect(coreSettings).toContain(SplitViewSetting);
    expect(settingPolicies(coreSettings)).toContainEqual(
      expect.objectContaining({ name: 'SplitViewEnabled', recommended: true }),
    );
    expect(v.safeParse(SplitViewSetting.schema, false).success).toBe(true);
    expect(v.safeParse(SplitViewSetting.schema, 'off').success).toBe(false);
  });
});

describe('the settings of the workspaces', () => {
  it('turns workspaces on by default, and a policy can set or recommend it', () => {
    expect(WorkspacesEnabledSetting).toMatchObject({
      key: 'workspaces.enabled',
      default: true,
      scope: 'global',
      policy: { name: 'WorkspacesEnabled', recommended: true },
      ui: { section: 'appearance', control: 'toggle' },
    });
    expect(coreSettings).toContain(WorkspacesEnabledSetting);
    expect(settingPolicies(coreSettings)).toContainEqual(
      expect.objectContaining({ name: 'WorkspacesEnabled', recommended: true }),
    );
    expect(v.safeParse(WorkspacesEnabledSetting.schema, 'off').success).toBe(false);
  });

  it('keeps the list of the workspaces and the deleted ones, which no policy sets', () => {
    expect(WorkspacesSetting.default).toEqual([
      { id: 'default', name: '', icon: 'home', color: 'blue', isolated: false },
    ]);
    expect(WorkspacesSetting.policy).toBeUndefined();
    expect(WorkspacesRemovedSetting.policy).toBeUndefined();
    expect(coreSettings).toContain(WorkspacesSetting);
    expect(coreSettings).toContain(WorkspacesRemovedSetting);
    expect(v.safeParse(WorkspacesRemovedSetting.schema, ['w1', 'w2']).success).toBe(true);
    // An id that leaves the folder of the partitions is never kept.
    expect(v.safeParse(WorkspacesRemovedSetting.schema, ['../w1']).success).toBe(false);
  });
});

/**
 * Whether a start brings the last session back, with the startup setting of people, of a
 * policy or none.
 */
async function restores(
  start: { readonly user?: string; readonly policy?: [number, PolicyLevel] },
  run: { readonly restart?: boolean; readonly unclean: boolean; readonly setup?: boolean },
): Promise<string | undefined> {
  const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
  const result: PolicyReadResult = {
    values:
      start.policy === undefined
        ? []
        : [
            {
              name: 'RestoreOnStartup',
              value: start.policy[0],
              level: start.policy[1],
              scope: 'machine',
              source: 'test',
            },
          ],
    errors: [],
  };
  const provider: PolicyProvider = { name: 'test', load: () => Promise.resolve(result) };
  const policies = new PolicyService(settingPolicies(coreSettings), [provider], logger);
  await policies.refresh();
  const store = {
    load: () =>
      Promise.resolve({
        user: start.user === undefined ? {} : { 'startup.page': start.user },
        workspaces: {},
      }),
    save: () => Promise.resolve(),
  };
  const settings = new SettingsService(coreSettings, policies, store, logger);
  await settings.load();
  return sessionStart(settings.inspect(StartupSetting), {
    restart: run.restart === true,
    unclean: run.unclean,
    setup: run.setup === true,
  });
}

describe('the start after a crash', () => {
  it('brings the last session back after a crash, also when people start with a new tab page', async () => {
    expect(await restores({}, { unclean: false })).toBe('asked');
    expect(await restores({ user: 'newtab' }, { unclean: false })).toBeUndefined();
    expect(await restores({ user: 'newtab' }, { unclean: true })).toBe('crash');
    expect(await restores({ user: 'pages' }, { unclean: true })).toBe('crash');
    // A restart from the settings page asks for the session.
    expect(await restores({ user: 'newtab' }, { restart: true, unclean: false })).toBe('asked');
    // The setup guide of a new profile opens instead.
    expect(await restores({}, { unclean: true, setup: true })).toBeUndefined();
  });

  it('keeps to a mandatory RestoreOnStartup after a crash, but not to a recommended one', async () => {
    // A new tab page or pages of its own, as on shared computers and kiosks: the next person
    // gets no tabs of the person before.
    expect(await restores({ policy: [5, 'mandatory'] }, { unclean: true })).toBeUndefined();
    expect(await restores({ policy: [4, 'mandatory'] }, { unclean: true })).toBeUndefined();
    expect(
      await restores({ user: 'restore', policy: [5, 'mandatory'] }, { unclean: true }),
    ).toBeUndefined();
    // A mandatory policy that restores still restores, and so does a restart.
    expect(await restores({ policy: [1, 'mandatory'] }, { unclean: true })).toBe('asked');
    expect(await restores({ policy: [5, 'mandatory'] }, { restart: true, unclean: true })).toBe(
      'asked',
    );
    // A recommended value is a default that people may change: the session comes back.
    expect(await restores({ policy: [5, 'recommended'] }, { unclean: false })).toBeUndefined();
    expect(await restores({ policy: [5, 'recommended'] }, { unclean: true })).toBe('crash');
  });
});

/** The settings of the browser with policies of the system, read as at a start. */
async function settingsWith(
  values: readonly {
    readonly name: string;
    readonly value: unknown;
    readonly level: PolicyLevel;
  }[],
  user: Readonly<Record<string, unknown>> = {},
): Promise<SettingsService> {
  const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
  const result: PolicyReadResult = {
    values: values.map((value) => ({ ...value, scope: 'machine', source: 'test' })),
    errors: [],
  };
  const provider: PolicyProvider = { name: 'test', load: () => Promise.resolve(result) };
  const policies = new PolicyService(settingPolicies(coreSettings), [provider], logger);
  await policies.refresh();
  const store = {
    load: () => Promise.resolve({ user: { ...user }, workspaces: {} }),
    save: () => Promise.resolve(),
  };
  const settings = new SettingsService(coreSettings, policies, store, logger);
  await settings.load();
  return settings;
}

describe('ReaderEnabledSetting and ReaderFontSetting', () => {
  it('offer the reader view in the font of the browser by default, in the section of page tools', () => {
    expect(ReaderEnabledSetting).toMatchObject({
      key: 'reader.enabled',
      default: true,
      scope: 'global',
      policy: { name: 'ReaderViewEnabled', recommended: true },
      ui: { section: 'pageTools', control: 'toggle', order: 1 },
    });
    expect(ReaderFontSetting).toMatchObject({
      key: 'reader.font',
      default: 'browser',
      scope: 'global',
      ui: { section: 'pageTools', control: 'select', order: 2 },
    });
    // No policy sets the font: it is a matter of taste.
    expect(ReaderFontSetting.policy).toBeUndefined();
    expect(coreSettings).toEqual(expect.arrayContaining([ReaderEnabledSetting, ReaderFontSetting]));
    expect(settingPolicies(coreSettings)).toContainEqual(
      expect.objectContaining({ name: 'ReaderViewEnabled', recommended: true }),
    );
    for (const font of ['browser', 'serif']) {
      expect(v.safeParse(ReaderFontSetting.schema, font).success).toBe(true);
    }
    for (const other of ['sans', 'Georgia', 1]) {
      expect(v.safeParse(ReaderFontSetting.schema, other).success).toBe(false);
    }
    expect(v.safeParse(ReaderEnabledSetting.schema, 'off').success).toBe(false);
  });

  it('follow a mandatory policy, and a recommended one only until people chose', async () => {
    const managed = await settingsWith([
      { name: 'ReaderViewEnabled', value: false, level: 'mandatory' },
    ]);
    expect(managed.get(ReaderEnabledSetting)).toBe(false);
    expect(managed.inspect(ReaderEnabledSetting).locked).toBe(true);
    const suggested = await settingsWith(
      [{ name: 'ReaderViewEnabled', value: false, level: 'recommended' }],
      { 'reader.enabled': true },
    );
    expect(suggested.get(ReaderEnabledSetting)).toBe(true);
    expect(suggested.inspect(ReaderEnabledSetting).locked).toBe(false);
    expect(
      (await settingsWith([{ name: 'ReaderViewEnabled', value: false, level: 'recommended' }])).get(
        ReaderEnabledSetting,
      ),
    ).toBe(false);
  });
});

describe('PictureInPictureEnabledSetting', () => {
  it('offers picture in picture by default after the font of the reader view, in the section of page tools', () => {
    expect(PictureInPictureEnabledSetting).toMatchObject({
      key: 'pictureInPicture.enabled',
      default: true,
      scope: 'global',
      policy: { name: 'PictureInPictureEnabled', recommended: true },
      ui: { section: 'pageTools', control: 'toggle', order: 3 },
    });
    expect(coreSettings).toContain(PictureInPictureEnabledSetting);
    expect(settingPolicies(coreSettings)).toContainEqual(
      expect.objectContaining({ name: 'PictureInPictureEnabled', recommended: true }),
    );
    expect(v.safeParse(PictureInPictureEnabledSetting.schema, 'off').success).toBe(false);
  });

  it('follows a mandatory policy, and a recommended one only until people chose', async () => {
    const managed = await settingsWith([
      { name: 'PictureInPictureEnabled', value: false, level: 'mandatory' },
    ]);
    expect(managed.get(PictureInPictureEnabledSetting)).toBe(false);
    expect(managed.inspect(PictureInPictureEnabledSetting).locked).toBe(true);
    const suggested = await settingsWith(
      [{ name: 'PictureInPictureEnabled', value: false, level: 'recommended' }],
      { 'pictureInPicture.enabled': true },
    );
    expect(suggested.get(PictureInPictureEnabledSetting)).toBe(true);
    expect(suggested.inspect(PictureInPictureEnabledSetting).locked).toBe(false);
    expect(
      (
        await settingsWith([
          { name: 'PictureInPictureEnabled', value: false, level: 'recommended' },
        ])
      ).get(PictureInPictureEnabledSetting),
    ).toBe(false);
  });
});

describe('TabSleepSetting and TabSleepAfterSetting', () => {
  it('put tabs to sleep after an hour by default, in the section of performance', () => {
    expect(TabSleepSetting).toMatchObject({
      key: 'tabs.sleep',
      default: true,
      policy: { name: 'SleepingTabsEnabled', recommended: true },
      ui: { section: 'performance', control: 'toggle', order: 1 },
    });
    expect(TabSleepAfterSetting).toMatchObject({
      key: 'tabs.sleepAfter',
      default: 3600,
      policy: { name: 'SleepingTabsTimeout', recommended: true },
      ui: { section: 'performance', control: 'select', order: 2 },
    });
    expect(coreSettings).toEqual(expect.arrayContaining([TabSleepSetting, TabSleepAfterSetting]));
    expect(settingPolicies(coreSettings).map((policy) => policy.name)).toEqual(
      expect.arrayContaining(['SleepingTabsEnabled', 'SleepingTabsTimeout']),
    );
  });

  it("take the times of Edge's policy in seconds, and no other", () => {
    for (const seconds of [30, 300, 900, 1800, 3600, 7200, 10800, 21600, 43200]) {
      expect(v.safeParse(TabSleepAfterSetting.schema, seconds).success).toBe(true);
    }
    expect(sleepAfterSeconds).toHaveLength(9);
    for (const other of [0, 60, 3601, '3600', -300]) {
      expect(v.safeParse(TabSleepAfterSetting.schema, other).success).toBe(false);
    }
    expect(v.safeParse(TabSleepSetting.schema, 'on').success).toBe(false);
  });

  it('follow a mandatory policy, and a recommended one only until people chose', async () => {
    const managed = await settingsWith([
      { name: 'SleepingTabsEnabled', value: false, level: 'mandatory' },
      { name: 'SleepingTabsTimeout', value: 300, level: 'mandatory' },
    ]);
    expect([managed.get(TabSleepSetting), managed.get(TabSleepAfterSetting)]).toEqual([false, 300]);
    expect(managed.inspect(TabSleepSetting).locked).toBe(true);
    expect(managed.inspect(TabSleepAfterSetting).locked).toBe(true);
    const suggested = await settingsWith(
      [{ name: 'SleepingTabsTimeout', value: 30, level: 'recommended' }],
      { 'tabs.sleepAfter': 7200 },
    );
    expect(suggested.get(TabSleepAfterSetting)).toBe(7200);
    expect(suggested.inspect(TabSleepAfterSetting).locked).toBe(false);
    expect(
      (await settingsWith([{ name: 'SleepingTabsTimeout', value: 30, level: 'recommended' }])).get(
        TabSleepAfterSetting,
      ),
    ).toBe(30);
    // A time that the policy does not know leaves the default.
    const unknown = await settingsWith([
      { name: 'SleepingTabsTimeout', value: 60, level: 'mandatory' },
    ]);
    expect(unknown.get(TabSleepAfterSetting)).toBe(3600);
  });
});

describe('ToolbarPlacementSetting and ToolbarAutoHideSetting', () => {
  it('keep the toolbar in its own row and showing by default, in the section of appearance', () => {
    expect(ToolbarPlacementSetting).toMatchObject({
      key: 'toolbar.placement',
      default: 'own-row',
      scope: 'global',
      policy: { name: 'ToolbarPlacement', recommended: true },
      ui: { section: 'appearance', control: 'select' },
    });
    expect(ToolbarAutoHideSetting).toMatchObject({
      key: 'toolbar.autoHide',
      default: false,
      scope: 'global',
      policy: { name: 'AutoHideToolbar', recommended: true },
      ui: { section: 'appearance', control: 'toggle' },
    });
    // Neither waits for a restart.
    for (const setting of [ToolbarPlacementSetting, ToolbarAutoHideSetting]) {
      expect(coreSettings).toContain(setting);
      expect(setting.restartRequired).toBeUndefined();
    }
    expect(settingPolicies(coreSettings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ToolbarPlacement', recommended: true }),
        expect.objectContaining({ name: 'AutoHideToolbar', recommended: true }),
      ]),
    );
    expect(v.safeParse(ToolbarPlacementSetting.schema, 'tab-row').success).toBe(true);
    expect(v.safeParse(ToolbarPlacementSetting.schema, 'sidebar').success).toBe(false);
    expect(v.safeParse(ToolbarAutoHideSetting.schema, 'on').success).toBe(false);
  });

  it('follow a mandatory policy, and a recommended one only until people chose', async () => {
    const managed = await settingsWith([
      { name: 'ToolbarPlacement', value: 'tab-row', level: 'mandatory' },
      { name: 'AutoHideToolbar', value: true, level: 'mandatory' },
    ]);
    expect([managed.get(ToolbarPlacementSetting), managed.get(ToolbarAutoHideSetting)]).toEqual([
      'tab-row',
      true,
    ]);
    expect(managed.inspect(ToolbarPlacementSetting).locked).toBe(true);
    expect(managed.inspect(ToolbarAutoHideSetting).locked).toBe(true);
    const suggested = await settingsWith(
      [{ name: 'AutoHideToolbar', value: true, level: 'recommended' }],
      { 'toolbar.autoHide': false },
    );
    expect(suggested.get(ToolbarAutoHideSetting)).toBe(false);
    expect(suggested.inspect(ToolbarAutoHideSetting).locked).toBe(false);
    // A place that the setting does not know leaves the default.
    const unknown = await settingsWith([
      { name: 'ToolbarPlacement', value: 'sidebar', level: 'mandatory' },
    ]);
    expect(unknown.get(ToolbarPlacementSetting)).toBe('own-row');
  });
});

describe('the layout presets', () => {
  it('set only values that the schemas of their settings take', () => {
    const settings = {
      'tabs.position': TabStripPositionSetting,
      'toolbar.placement': ToolbarPlacementSetting,
      'toolbar.autoHide': ToolbarAutoHideSetting,
      'appearance.density': DensitySetting,
    } as const;
    for (const key of layoutKeys) expect(settings[key].key).toBe(key);
    const refused = layoutPresetIds.flatMap((id) =>
      layoutKeys
        .filter((key) => !v.safeParse(settings[key].schema, layoutPresets[id][key]).success)
        .map((key) => `${id} ${key}`),
    );
    expect(refused).toEqual([]);
  });

  it('apply in one step, and leave the settings that a policy sets as they are', async () => {
    const managed = await settingsWith([
      { name: 'TabStripPosition', value: 'left', level: 'mandatory' },
    ]);
    const changes: string[][] = [];
    managed.onDidChange(({ keys }) => changes.push([...keys].toSorted()));
    const definitions = {
      'tabs.position': TabStripPositionSetting,
      'toolbar.placement': ToolbarPlacementSetting,
      'toolbar.autoHide': ToolbarAutoHideSetting,
      'appearance.density': DensitySetting,
    } as const;
    const written = managed.setMany(
      layoutKeys.map((key) => [definitions[key], layoutPresets.compact[key]] as const),
    );
    expect(written).toEqual({
      ok: true,
      value: {
        applied: ['toolbar.placement', 'toolbar.autoHide', 'appearance.density'],
        locked: ['tabs.position'],
      },
    });
    expect(changes).toEqual([['appearance.density', 'toolbar.autoHide', 'toolbar.placement']]);
    expect(managed.get(TabStripPositionSetting)).toBe('left');
    expect(managed.get(ToolbarPlacementSetting)).toBe('tab-row');
    expect(managed.get(DensitySetting)).toBe('compact');
  });
});
