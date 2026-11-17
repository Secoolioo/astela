import { closeGroup, editGroups, groupsOf } from '../domain/tabs/tab-groups.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import type { PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import { EditGroup, GroupAction } from '../shared/ipc/overlay-contracts.ts';
import { EditGroupRequested } from '../shared/ipc/shell-later-contracts.ts';
import { focusBackOf, overlayBySender, overlayOf, rectOf, track } from './overlays.ts';

/** What the popover of a group of tabs needs from the browser process. */
export interface GroupEditorDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
}

/** The group that a popover of a group edits, in its window. */
interface Editing {
  readonly window: BrowserWindowController;
  readonly groupId: string;
}

const editing = new WeakMap<WindowOverlay, Editing>();
let connected = false;

/**
 * Opens the popover of a group of tabs at its chip: its name and color, which change at once,
 * a new tab in the group, and the ways to end the group or close its tabs. Escape and a click
 * next to it close it; so does the group when it is gone, such as after its last tab closed.
 * @param window - The window of the group.
 * @param groupId - The group.
 * @param anchor - The chip, and whether the keyboard opened the popover.
 * @param deps - What the popover needs.
 */
export function openGroupEditor(
  window: BrowserWindowController,
  groupId: string,
  anchor: PopoverAnchor,
  deps: GroupEditorDependencies,
): void {
  const group = groupsOf(window.tabs.all).find((candidate) => candidate.id === groupId);
  if (group === undefined || window.window.isDestroyed()) return;
  const overlay = overlayOf(window, deps.overlay, deps.router);
  if (!connected) connect(deps.router);
  const state: Editing = { window, groupId };
  const gone = (): boolean => !window.tabs.all.some((tab) => tab.group?.id === groupId);
  const watch = window.tabs.onDidChange(() => {
    if (editing.get(overlay) === state && gone()) overlay.close();
  });
  overlay.open(
    { kind: 'group', anchor: rectOf(anchor), id: group.id, name: group.name, color: group.color },
    {
      focusBack: focusBackOf(window, anchor),
      // Escape belongs to the page, which lets an input method finish the name first; what was
      // typed is kept from the questions of sites.
      keys: { escape: 'page' },
      yieldsToQuestions: false,
      onClose: () => {
        watch.dispose();
        if (editing.get(overlay) === state) editing.delete(overlay);
      },
    },
  );
  editing.set(overlay, state);
  track(window, overlay);
}

/**
 * Puts the active tab of a window, with the other tab of its split view, in a new group, whose
 * popover then opens at its chip, as the command `tab.newGroup` does from its shortcut or from
 * the command palette. Pinned tabs are never in a group.
 * @param window - The window.
 * @param router - IPC router, which asks the shell to open the popover.
 */
export function newGroup(window: BrowserWindowController, router: IpcRouter): void {
  const active = window.tabs.active;
  if (active === undefined || active.pinned) return;
  const group = editGroups(window.tabs, (strip) => strip.createGroup(active.id));
  if (group !== undefined) {
    // The keyboard asked for it, so the focus goes back to the shell when the popover closes.
    router.publish(EditGroupRequested, window.shellContents, { groupId: group.id, keyboard: true });
  }
}

/**
 * The group that the popover of the page that sent a request edits, with its overlay.
 * @param senderId - The id of the sending web contents.
 */
function editedBy(senderId: number): (Editing & { overlay: WindowOverlay }) | undefined {
  const overlay = overlayBySender(senderId);
  const state = overlay === undefined ? undefined : editing.get(overlay);
  return overlay === undefined || state === undefined ? undefined : { ...state, overlay };
}

/**
 * Handles the requests of the popovers of groups, which act on the group that the popover of
 * the sending page shows.
 * @param router - IPC router.
 */
function connect(router: IpcRouter): void {
  connected = true;
  router.handle(EditGroup, ({ name, color }, { sender }) => {
    const found = editedBy(sender.id);
    // The name changes while people type, and the page keeps its field as it is.
    if (found !== undefined) {
      editGroups(found.window.tabs, (strip) => strip.updateGroup(found.groupId, { name, color }));
    }
    return null;
  });
  router.handle(GroupAction, ({ action }, { sender }) => {
    const found = editedBy(sender.id);
    if (found === undefined) return null;
    const { window, groupId, overlay } = found;
    const group = groupsOf(window.tabs.all).find((candidate) => candidate.id === groupId);
    overlay.close();
    if (group === undefined) return null;
    if (action === 'newTab') window.tabs.open(undefined, { group });
    else if (action === 'ungroup') editGroups(window.tabs, (strip) => strip.ungroup(groupId));
    else closeGroup(window.tabs, groupId);
    return null;
  });
}
