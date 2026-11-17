import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { session } from 'electron';
import type { Logger } from '../kernel/logging/logger.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { TabId } from '../domain/tabs/tab-service.ts';
import {
  mergeWorkspaces,
  moveToWorkspace,
  removeWorkspace as removeStrip,
  switchWorkspace,
  workspaceStrips,
} from '../domain/tabs/workspace-strips.ts';
import {
  addWorkspace,
  defaultWorkspaceId,
  moveWorkspace,
  newWorkspaceId,
  partitionFolder,
  partitionOf,
  removeWorkspace,
  stepWorkspace,
  updateWorkspace,
  workspaceAt,
  type Workspace,
} from '../domain/workspaces/workspaces.ts';
import type {
  BrowserWindowController,
  LaterCommand,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import type { OverlayAnchor, PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  DeleteWorkspace,
  MoveWorkspace,
  SaveWorkspace,
  SwitchWorkspace,
  type WorkspaceList,
} from '../shared/ipc/overlay-contracts.ts';
import { ShellCommand } from '../shared/ipc/shell-contracts.ts';
import { shortcutsOf } from '../shared/menu-shortcuts.ts';
import { windowCommands } from '../shared/shortcuts.ts';
import { workspaceLimit } from '../shared/workspaces.ts';
import {
  WorkspacesEnabledSetting,
  WorkspacesRemovedSetting,
  WorkspacesSetting,
} from './core-settings.ts';
import {
  existingOverlay,
  focusBackOf,
  overlayBySender,
  overlayOf,
  rectOf,
  track,
} from './overlays.ts';
import { newGroup } from './tab-groups.ts';

/** What the workspaces need from the browser process. */
export interface WorkspaceDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  readonly settings: SettingsService;
  readonly logger: Logger;
  /** The partition of the web pages of every workspace that does not keep its data apart. */
  readonly webPartition: string;
  /** The folder of the profile, whose folder `Partitions` keeps the data of partitions. */
  readonly userData: string;
}

/** What the code of the workspaces offers the rest of the browser process. */
export interface Workspaces {
  /** Opens the list of the workspaces of a window at the button of the workspaces. */
  open(window: BrowserWindowController, anchor: PopoverAnchor): void;
  /** Runs a command of the workspaces, or the one that puts the active tab in a new group. */
  run(window: BrowserWindowController, command: LaterCommand): void;
  /** Moves a tab of a window into another workspace. */
  moveTab(window: BrowserWindowController, tabId: TabId, workspaceId: string): void;
  /**
   * The workspaces that a tab of a window can move into, for the menu of the tab, and whether
   * it loads again there; none in private windows, popups and while workspaces are off.
   */
  targets(
    window: BrowserWindowController,
    tabId: TabId,
  ): { readonly workspace: Workspace; readonly reload: boolean }[];
  /** Deletes the folders of the partitions of deleted workspaces, once they are free. */
  removeDeletedPartitions(): Promise<void>;
}

/** The list of the workspaces that an overlay shows, with its window. */
interface ShownList {
  readonly window: BrowserWindowController;
  readonly anchor: OverlayAnchor;
}

const lists = new WeakMap<WindowOverlay, ShownList>();
let code: Workspaces | undefined;

/**
 * The code of the workspaces, made with its first use, which connects the requests of the list
 * of the workspaces and follows the changes of the workspaces in the settings. Its first use
 * brings every window in line with the settings, which may have changed before it loaded, as
 * when a policy turned the workspaces off.
 * @param deps - What the workspaces need.
 */
export function workspaces(deps: WorkspaceDependencies): Workspaces {
  if (code !== undefined) return code;
  connect(deps);
  code = {
    open: (window, anchor) => openList(window, anchor, deps),
    run: (window, command) => runCommand(window, command, deps),
    moveTab: (window, tabId, workspaceId) => moveTab(window, tabId, workspaceId, deps),
    targets: (window, tabId) => targetsOf(window, tabId, deps),
    removeDeletedPartitions: () => removeDeletedPartitions(deps),
  };
  applyWorkspaces(deps);
  return code;
}

/** The workspaces of the profile while windows have them, or `undefined` while they are off. */
function listOf(deps: WorkspaceDependencies): readonly Workspace[] | undefined {
  return deps.settings.get(WorkspacesEnabledSetting)
    ? deps.settings.get(WorkspacesSetting)
    : undefined;
}

/** The workspaces of a window: none in private windows and popups, or while they are off. */
function windowList(
  window: BrowserWindowController,
  deps: WorkspaceDependencies,
): readonly Workspace[] | undefined {
  return window.isPrivate || window.popup ? undefined : listOf(deps);
}

/**
 * Opens the list of the workspaces of a window at the button of the workspaces, below it, or
 * above it with the tab strip at the bottom; the list follows the changes of the tabs and of
 * the workspaces while it shows.
 */
function openList(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  deps: WorkspaceDependencies,
): void {
  const list = windowList(window, deps);
  if (list === undefined || window.window.isDestroyed()) return;
  const overlay = overlayOf(window, deps.overlay, deps.router);
  const shown: ShownList = { window, anchor: rectOf(anchor) };
  // The numbers of tabs and their sound follow the tabs, at most once per frame.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watch = window.tabs.onDidChange(() => {
    timer ??= setTimeout(() => {
      timer = undefined;
      refresh(overlay, deps);
    }, 16);
  });
  overlay.open(contentOf(shown, list), {
    popover: { kind: 'workspaces', folder: null },
    focusBack: focusBackOf(window, anchor),
    // Escape belongs to the page, which leaves its form first and lets an input method finish
    // a name; what was typed into the form is kept from the questions of sites.
    keys: { escape: 'page' },
    yieldsToQuestions: false,
    onClose: () => {
      watch.dispose();
      clearTimeout(timer);
      if (lists.get(overlay) === shown) lists.delete(overlay);
    },
  });
  lists.set(overlay, shown);
  track(window, overlay);
}

/**
 * What the list of the workspaces of a window shows, with the shortcuts of the workspaces as
 * they are now.
 */
function contentOf(shown: ShownList, list: readonly Workspace[]): WorkspaceList {
  const { window } = shown;
  const table = window.shortcuts();
  return {
    kind: 'workspaces',
    anchor: shown.anchor,
    mac: process.platform === 'darwin',
    current: window.tabs.workspace,
    full: list.length >= workspaceLimit,
    items: list.map((workspace, index) => {
      const tabs = window.tabs.strips.find((strip) => strip.workspace === workspace.id)?.all ?? [];
      const command = windowCommands.find((each) => each === `workspace.select${index + 1}`);
      return {
        ...workspace,
        tabs: tabs.length,
        audible: tabs.some((tab) => tab.audible),
        shortcut: command === undefined ? null : (shortcutsOf(table, command)[0] ?? null),
      };
    }),
  };
}

/** Brings the list of the workspaces that an overlay shows up to date, or closes it. */
function refresh(overlay: WindowOverlay, deps: WorkspaceDependencies): void {
  const shown = lists.get(overlay);
  if (shown === undefined || overlay.content?.kind !== 'workspaces') return;
  const list = windowList(shown.window, deps);
  if (list === undefined) overlay.close();
  else overlay.update(contentOf(shown, list));
}

/** The list of the workspaces that the overlay page that sent a request shows. */
function listBy(senderId: number): (ShownList & { overlay: WindowOverlay }) | undefined {
  const overlay = overlayBySender(senderId);
  const shown = overlay === undefined ? undefined : lists.get(overlay);
  return overlay === undefined || shown === undefined || overlay.content?.kind !== 'workspaces'
    ? undefined
    : { ...shown, overlay };
}

/** Saves the workspaces of the profile. */
function write(deps: WorkspaceDependencies, list: readonly Workspace[]): boolean {
  const result = deps.settings.set(WorkspacesSetting, list);
  if (!result.ok) deps.logger.warn('The workspaces were not saved', { error: result.error.kind });
  return result.ok;
}

/**
 * Shows a workspace in a window, with its active tab, or a new tab page in a workspace that has
 * no tab in the window yet. The strips of the window keep the order of the workspaces.
 */
function showWorkspace(
  window: BrowserWindowController,
  id: string,
  deps: WorkspaceDependencies,
): void {
  const list = windowList(window, deps);
  if (list === undefined || !list.some((workspace) => workspace.id === id)) return;
  if (!switchWorkspace(window.tabs, id)) return;
  workspaceStrips(window.tabs).order(list.map((workspace) => workspace.id));
}

/** Handles the requests of the lists of the workspaces, and follows the settings. */
function connect(deps: WorkspaceDependencies): void {
  const { router, settings } = deps;
  router.handle(SwitchWorkspace, ({ id }, { sender }) => {
    const found = listBy(sender.id);
    if (found === undefined) return null;
    found.overlay.close();
    showWorkspace(found.window, id, deps);
    return null;
  });
  router.handle(SaveWorkspace, ({ id, name, icon, color, isolated }, { sender }) => {
    const found = listBy(sender.id);
    const list = found === undefined ? undefined : windowList(found.window, deps);
    if (found === undefined || list === undefined) return null;
    if (id !== undefined) {
      const changed = updateWorkspace(list, id, { name, icon, color });
      return changed !== undefined && write(deps, changed) ? id : null;
    }
    // A new workspace never takes the id of one whose folder is still to be deleted.
    const taken = [
      ...list.map((workspace) => workspace.id),
      ...settings.get(WorkspacesRemovedSetting),
    ];
    const made = newWorkspaceId(taken, Math.random);
    const added = addWorkspace(list, { name, icon, color }, made, isolated);
    if (added === undefined || !write(deps, added)) return null;
    // The window shows the new workspace, with a new tab page.
    found.overlay.close();
    showWorkspace(found.window, made, deps);
    return made;
  });
  router.handle(MoveWorkspace, ({ id, index }, { sender }) => {
    const found = listBy(sender.id);
    const list = found === undefined ? undefined : windowList(found.window, deps);
    const moved = list === undefined ? undefined : moveWorkspace(list, id, index);
    if (moved !== undefined) write(deps, moved);
    return null;
  });
  router.handle(DeleteWorkspace, async ({ id }, { sender }) => {
    const found = listBy(sender.id);
    if (found !== undefined && windowList(found.window, deps) !== undefined) {
      await deleteWorkspace(id, deps);
    }
    return null;
  });
  // Every window follows the workspaces of the settings, and whether they are on.
  settings.onDidChange(({ keys }) => {
    if (keys.includes(WorkspacesSetting.key) || keys.includes(WorkspacesEnabledSetting.key)) {
      applyWorkspaces(deps);
    }
  });
}

/**
 * Brings every window in line with the workspaces of the settings: while they are off, each
 * window shows the tabs of all its workspaces together in the default one; a window that shows a
 * workspace that is gone shows the default one; the strips keep the order of the workspaces.
 */
function applyWorkspaces(deps: WorkspaceDependencies): void {
  const list = listOf(deps);
  for (const window of deps.windows.all) {
    if (window.isPrivate || window.popup || window.window.isDestroyed()) continue;
    const ids = (list ?? deps.settings.get(WorkspacesSetting)).map((workspace) => workspace.id);
    if (list === undefined) {
      mergeWorkspaces(window.tabs, defaultWorkspaceId, ids);
      continue;
    }
    if (!ids.includes(window.tabs.workspace)) switchWorkspace(window.tabs, defaultWorkspaceId);
    if (window.tabs.strips.length > 1) workspaceStrips(window.tabs).order(ids);
  }
  for (const window of deps.windows.all) {
    const overlay = existingOverlay(window);
    if (overlay !== undefined) refresh(overlay, deps);
  }
  deps.windows.refreshShells();
}

/**
 * Deletes a workspace: every window that shows it shows the default one, its tabs close in
 * every window, and popups of its pages close. Its definition and its overrides of settings go;
 * the cookies, site data, cache and sign-ins of a workspace that kept them apart are deleted, and
 * its folder goes at the next start, when Chromium no longer holds its files.
 */
async function deleteWorkspace(id: string, deps: WorkspaceDependencies): Promise<void> {
  const list = deps.settings.get(WorkspacesSetting);
  const workspace = list.find((candidate) => candidate.id === id);
  const rest = removeWorkspace(list, id);
  if (workspace === undefined || rest === undefined) return;
  for (const window of deps.windows.all) {
    if (window.window.isDestroyed()) continue;
    if (window.popup && window.tabs.workspace === id) window.window.close();
    else if (!window.isPrivate) removeStrip(window.tabs, id, defaultWorkspaceId);
  }
  if (!write(deps, rest)) return;
  deps.settings.clearWorkspace(id);
  if (!workspace.isolated) return;
  const removed = deps.settings.get(WorkspacesRemovedSetting).filter((other) => other !== id);
  deps.settings.set(WorkspacesRemovedSetting, [...removed, id].slice(-100));
  const gone = session.fromPartition(partitionOf(workspace, deps.webPartition));
  try {
    const { favicons } = await import('../platform/electron/favicons.ts');
    favicons.forget(gone);
    await Promise.all([gone.clearStorageData(), gone.clearCache(), gone.clearAuthCache()]);
  } catch (error: unknown) {
    deps.logger.warn('The data of a deleted workspace was not deleted', { error: String(error) });
  }
}

/** Runs a command of the workspaces, or the one that puts the active tab in a new group. */
function runCommand(
  window: BrowserWindowController,
  command: LaterCommand,
  deps: WorkspaceDependencies,
): void {
  if (command === 'tab.newGroup') {
    newGroup(window, deps.router);
    return;
  }
  const list = windowList(window, deps);
  if (list === undefined) return;
  if (command === 'workspace.open') {
    // The shell opens the list at its button, or at the menu button without it.
    deps.router.publish(ShellCommand, window.shellContents, 'workspaces.open');
    return;
  }
  const target =
    command === 'workspace.next' || command === 'workspace.previous'
      ? stepWorkspace(list, window.tabs.workspace, command === 'workspace.next' ? 1 : -1)
      : workspaceAt(list, Number(command.slice(-1)));
  if (target !== undefined) showWorkspace(window, target.id, deps);
}

/** The partition of the pages of a workspace of the profile. */
function partitionOfId(id: string | undefined, deps: WorkspaceDependencies): string {
  const workspace = deps.settings.get(WorkspacesSetting).find((candidate) => candidate.id === id);
  return partitionOf(workspace, deps.webPartition);
}

/** The workspaces that a tab can move into, and whether it loads again there. */
function targetsOf(
  window: BrowserWindowController,
  tabId: TabId,
  deps: WorkspaceDependencies,
): { readonly workspace: Workspace; readonly reload: boolean }[] {
  const list = windowList(window, deps);
  const from = window.tabs.workspaceOf(tabId);
  if (list === undefined || from === undefined) return [];
  const partition = partitionOfId(from, deps);
  return list
    .filter((workspace) => workspace.id !== from)
    .map((workspace) => ({
      workspace,
      reload: partitionOf(workspace, deps.webPartition) !== partition,
    }));
}

/**
 * Moves a tab of a window into another workspace. A tab whose partition changes gets a new view
 * there, which loads its back and forward entries again, without the states of their pages.
 */
function moveTab(
  window: BrowserWindowController,
  tabId: TabId,
  workspaceId: string,
  deps: WorkspaceDependencies,
): void {
  const list = windowList(window, deps);
  if (list === undefined || !list.some((workspace) => workspace.id === workspaceId)) return;
  const reload =
    partitionOfId(window.tabs.workspaceOf(tabId), deps) !== partitionOfId(workspaceId, deps);
  const history = reload ? window.historyOf(tabId, true) : undefined;
  if (!moveToWorkspace(window.tabs, tabId, workspaceId)) return;
  workspaceStrips(window.tabs).order(list.map((workspace) => workspace.id));
  if (!reload) return;
  window.renewView(tabId, history);
}

/**
 * Deletes the folders in `Partitions` of the deleted workspaces that kept their data apart, which
 * Chromium held while they were in use. Only the folders of ids that a workspace can have go,
 * never anything outside `Partitions`; an id whose folder could not be deleted is tried again at
 * the next start.
 */
async function removeDeletedPartitions(deps: WorkspaceDependencies): Promise<void> {
  const removed = deps.settings.get(WorkspacesRemovedSetting);
  const kept: string[] = [];
  for (const id of removed) {
    const folder = partitionFolder(id);
    if (folder === undefined) continue;
    try {
      await rm(join(deps.userData, 'Partitions', folder), { recursive: true, force: true });
    } catch (error: unknown) {
      kept.push(id);
      deps.logger.warn('The folder of a deleted workspace was not deleted', {
        error: String(error),
      });
    }
  }
  const now = deps.settings
    .get(WorkspacesRemovedSetting)
    .filter((id) => kept.includes(id) || !removed.includes(id));
  deps.settings.set(WorkspacesRemovedSetting, now);
}
