import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { SettingsService } from '../../domain/settings/settings-service.ts';
import { TabService, type TabViewPort } from '../../domain/tabs/tab-service.ts';
import { switchWorkspace } from '../../domain/tabs/workspace-strips.ts';
import type { WindowManager } from '../../platform/electron/browser-window.ts';
import type { IpcRouter } from '../../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../../platform/electron/overlay.ts';
import { defaultWorkspaces, type Workspace } from '../../shared/workspaces.ts';
import {
  WorkspacesEnabledSetting,
  WorkspacesRemovedSetting,
  WorkspacesSetting,
} from '../core-settings.ts';
import type { WorkspaceDependencies } from '../workspaces.ts';

vi.mock('electron', () => ({ session: {}, WebContentsView: vi.fn() }));

const folders: string[] = [];

beforeEach(() => {
  // The code of the workspaces is made once per run of the browser, so each test loads it anew.
  vi.resetModules();
});

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

/** Settings with some values, which tell nobody of their changes. */
function settingsWith(values: Map<string, unknown>): SettingsService {
  return {
    get: (setting: { readonly key: string }) => values.get(setting.key),
    set: (setting: { readonly key: string }, value: unknown) => {
      values.set(setting.key, value);
      return { ok: true, value: undefined };
    },
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as SettingsService;
}

/** What the code of the workspaces needs, with some settings and windows. */
function dependencies(
  settings: SettingsService,
  windows: Partial<WindowManager>,
  userData = '',
): WorkspaceDependencies {
  return {
    windows: { all: [], refreshShells: vi.fn(), ...windows } as unknown as WindowManager,
    router: { handle: vi.fn() } as unknown as IpcRouter,
    overlay: {} as OverlayOptions,
    settings,
    logger: { warn: vi.fn() } as unknown as Logger,
    webPartition: 'persist:web',
    userData,
  };
}

/** Views of a window, which a test of the tabs alone does not need. */
class FakeViews implements TabViewPort {
  create(): void {}
  show(): void {}
  destroy(): void {}
  load(): void {}
  run(): void {}
  sleep(): boolean {
    return true;
  }
}

describe('the folders of deleted workspaces', () => {
  it('go at the next start, and nothing outside the folder of the partitions does', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'workspaces-'));
    folders.push(userData);
    const partitions = join(userData, 'Partitions');
    for (const name of ['ws-w1', 'ws-w2', 'web', 'x']) {
      await mkdir(join(partitions, name), { recursive: true });
    }
    const values = new Map<string, unknown>([
      [WorkspacesRemovedSetting.key, ['w1', '../x', 'w3']],
      [WorkspacesEnabledSetting.key, true],
      [WorkspacesSetting.key, defaultWorkspaces],
    ]);
    const { workspaces } = await import('../workspaces.ts');
    const code = workspaces(dependencies(settingsWith(values), {}, userData));
    await code.removeDeletedPartitions();
    expect((await readdir(partitions)).toSorted()).toEqual(['web', 'ws-w2', 'x']);
    expect(values.get(WorkspacesRemovedSetting.key)).toEqual([]);
  });
});

describe('the code of the workspaces', () => {
  it('brings every window in line with the settings at its first use, as after a change before it loaded', async () => {
    const work: Workspace = {
      id: 'w1',
      name: 'Work',
      icon: 'briefcase',
      color: 'teal',
      isolated: false,
    };
    const tabs = new TabService(new FakeViews(), 'about:blank');
    tabs.open('https://a.example/');
    switchWorkspace(tabs, 'w1');
    tabs.open('https://b.example/');
    expect(tabs.strips).toHaveLength(2);
    const window = { isPrivate: false, popup: false, window: { isDestroyed: () => false }, tabs };
    // The workspaces were turned off before their code loaded.
    const values = new Map<string, unknown>([
      [WorkspacesEnabledSetting.key, false],
      [WorkspacesSetting.key, [...defaultWorkspaces, work]],
      [WorkspacesRemovedSetting.key, []],
    ]);
    const refreshShells = vi.fn();
    const { workspaces } = await import('../workspaces.ts');
    workspaces(
      dependencies(settingsWith(values), {
        all: [window] as unknown as WindowManager['all'],
        refreshShells,
      }),
    );
    expect(tabs.workspace).toBe('default');
    expect(tabs.strips).toHaveLength(1);
    expect(tabs.all.map((tab) => tab.url)).toEqual([
      'https://a.example/',
      'about:blank',
      'https://b.example/',
    ]);
    expect(tabs.active?.url).toBe('https://b.example/');
    expect(refreshShells).toHaveBeenCalledOnce();
  });
});
