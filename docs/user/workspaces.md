# Workspaces

> **Status:** available from 0.1.0-beta.7.

A workspace is a named set of tabs, for work, a project or private errands. Each window shows the tabs of one workspace at a time and keeps the tabs of the others open in the background, so you can switch between them without losing anything: no page loads again. A workspace can also keep its cookies, site data and sign-ins apart from the others, so that you can be signed in to the same site with two accounts.

## The button of the workspaces

The first button of the tab strip shows the icon of the workspace that the window shows, in its color; in a tab strip at a side, it shows the name too. Every profile has the workspace **Default**, which you can rename. Private windows and popups have no workspaces.

Click the button to open the list of the workspaces. Each workspace shows its icon, its name, how many tabs it has in this window, whether one of them plays sound, _Own cookies_ when it keeps its cookies apart, and its shortcut. The workspace that the window shows is marked. Click a workspace to show it; the arrow keys go from one to the next, and Escape closes the list.

## Making a workspace

In the list, **New workspace** opens a form:

- **Name:** up to 40 characters; every workspace but Default needs one.
- **Icon:** one of 16 icons, such as a house, a briefcase, a book or a star.
- **Color:** blue, teal, green, orange, red or graphite, the colors of groups of tabs.
- **Keep its cookies and sign-ins apart:** sites in the workspace see none of the cookies, site data and sign-ins of the other workspaces, and the other way round. You choose this when you make the workspace; it cannot be changed later.

**Create** makes the workspace, and the window shows it with a new tab. A profile has at most 20 workspaces.

## Switching between workspaces

- **The list:** click a workspace.
- **Shortcuts:** `Alt+1` to `Alt+9` show the first to the ninth workspace of the list on Windows and Linux, `Control+1` to `Control+9` on macOS. The digits of the number pad stay free, as Windows types characters with Alt and them. Private windows and popups have no workspaces, so their pages get these keys.
- **Commands:** the [command palette](command-palette.md) has **Next workspace**, **Previous workspace** and **Show the workspaces**. You can give them shortcuts in the [settings](settings.md).
- **Finding a tab:** [tab search](command-palette.md) and the suggestions of the [address bar](address-bar.md) offer the open tabs of every workspace of the window. Choosing a tab of another workspace shows that workspace with the tab.

The window then shows the tabs of the other workspace, with its active tab and its split view, and the tabs of the workspace before stay open, playing sound if they did. Screen readers say the name of the workspace. A workspace without tabs in this window opens a new tab. [Sleeping tabs](tabs.md#sleeping-tabs) go to sleep in every workspace as they do in the one that shows.

## Moving tabs between workspaces

- **The menu of a tab:** **Move to workspace** lists every other workspace.
- **Dragging:** drag a tab onto the button of the workspaces. A target for each other workspace shows next to the button; drop the tab on one of them.

The tab goes to the end of the tabs of that workspace, or of its pinned tabs, and leaves its group and its split view. A tab that moves between a workspace that keeps its cookies apart and another workspace loads its page again there, signed in as that workspace is; it keeps its back and forward history, but not what you typed into a page. The menu says _(loads again)_ and the target _The tab loads again._ for such a workspace. Otherwise the page moves as it is.

## New windows, popups and links

- A new window shows the workspace of the window that you opened it from.
- A tab or a popup that a page opens stays in the workspace of that page, also when the window shows another workspace meanwhile.
- A link from another app opens in the workspace that the window shows.

## Renaming, moving and deleting a workspace

In the list, the pencil next to a workspace opens its form, where you change its name, icon and color. **Move up** and **Move down** move it in the list, which changes its shortcut. **Delete workspace…** asks first, then closes its tabs in every window and deletes the workspace; for a workspace that keeps its cookies apart, its cookies, site data and sign-ins are deleted too. Default cannot be deleted.

## What workspaces share

History, bookmarks, downloads, the [permissions of sites](site-permissions.md) and the zoom of sites are the same in every workspace. **Clear browsing data** in the settings clears every workspace.

## Turning workspaces off

**Settings → Appearance → Workspaces** turns them off. Then every window shows the tabs of all its workspaces together, those of Default first, each group and split view as it was; the button, the shortcuts and the menu item are gone. When you turn workspaces on again, every tab stays in Default, and the other workspaces start empty. An administrator can turn workspaces off, or recommend a setting, with the policy `WorkspacesEnabled`.

## At the next start

When Astela starts again with the last session, each window comes back with the tabs of every workspace and shows the workspace that it showed; only its active tab loads. See [tabs at the next start](tabs.md#tabs-at-the-next-start). Tabs of a workspace that no longer exists come back in Default.
