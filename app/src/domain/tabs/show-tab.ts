import type { TabId, TabService } from './tab-service.ts';

/**
 * Shows a tab of a window, such as one that tab search or the suggestions of the address bar
 * found: a tab of the workspace that the window shows becomes its active tab, whose group shows
 * its tabs for it, and a tab of another workspace shows with its workspace. Only a window with
 * workspaces has such a tab, so the code of the workspaces loads only for it, and the code of
 * groups only with that of the workspaces.
 * @param tabs - The tabs of the window.
 * @param id - The tab; a tab that the window does not have shows nothing.
 */
export async function showTab(tabs: TabService, id: TabId): Promise<void> {
  const workspace = tabs.workspaceOf(id);
  if (workspace === tabs.workspace) {
    tabs.activate(id);
  } else if (workspace !== undefined) {
    const { revealTab } = await import('./workspace-strips.ts');
    revealTab(tabs, id);
  }
}
