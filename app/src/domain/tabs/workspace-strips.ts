import { defaultWorkspaceId } from '../../shared/workspaces.ts';
import { GroupedTabStrip } from './tab-groups.ts';
import type { RestoredWindow } from '../session/session.ts';
import type { Tab, TabId, TabService } from './tab-service.ts';
import type { TabHistory } from './view-history.ts';
import {
  TabStrip,
  type ClosedTab,
  type ReopenPlace,
  type SplitPair,
  type StripPlace,
  type StripTab,
  type TabGroup,
} from './tab-strip.ts';

/**
 * The tabs of a window with workspaces: the tabs of each workspace in a strip of their own, of
 * which the window shows one, `workspace`. It takes the place of the window's strip with the
 * window's second workspace and keeps the rules of the strip of each workspace. What concerns the
 * shown tabs, such as the active tab, the closed tabs or a new tab, is the shown strip's; what
 * concerns one tab, such as its title, its split view or a move, is the strip's that holds it. A
 * tab that a page or a tab opens goes into the strip of that tab, also when the window shows
 * another workspace. Activating a tab of a strip that does not show makes it that strip's active
 * tab without showing it, so that the window shows only the shown strip's tabs.
 */
export class WorkspaceStrips<T extends StripTab> extends TabStrip<T> {
  /** The strip of each workspace that has one, in the order of the workspaces. */
  private readonly byWorkspace = new Map<string, TabStrip<T>>();

  /** @param from - The strip that the window had, whose workspace shows. */
  constructor(from: TabStrip<T>) {
    super(from.workspace);
    this.byWorkspace.set(from.workspace, from);
  }

  /** The workspaces that have a strip, in their order. */
  get workspaces(): readonly string[] {
    return [...this.byWorkspace.keys()];
  }

  /** The strip of the workspace that the window shows. */
  get shownStrip(): TabStrip<T> {
    return this.strip(this.workspace);
  }

  /**
   * The strip of a workspace, which an empty one is made for the first time.
   * @param workspace - The workspace.
   */
  strip(workspace: string): TabStrip<T> {
    let strip = this.byWorkspace.get(workspace);
    if (strip === undefined) {
      strip = new TabStrip<T>(workspace);
      this.byWorkspace.set(workspace, strip);
    }
    return strip;
  }

  /**
   * Puts another strip in the place of a workspace's strip, such as one with groups.
   * @param strip - The strip, whose workspace it takes.
   */
  setStrip(strip: TabStrip<T>): void {
    this.byWorkspace.set(strip.workspace, strip);
  }

  /**
   * The strip that holds a tab.
   * @param id - The tab.
   */
  stripOf(id: string): TabStrip<T> | undefined {
    return [...this.byWorkspace.values()].find((strip) => strip.has(id));
  }

  /**
   * Shows the strip of a workspace, an empty one the first time; the window shows its tabs once
   * `TabService.edit` tells the views.
   * @param workspace - The workspace.
   */
  show(workspace: string): void {
    this.strip(workspace);
    this.workspace = workspace;
  }

  /**
   * Takes the strip of a workspace that the window does not show out of the window.
   * @param workspace - The workspace.
   * @returns Its tabs, which the caller closes.
   */
  drop(workspace: string): T[] {
    const strip = this.byWorkspace.get(workspace);
    if (strip === undefined || workspace === this.workspace) return [];
    this.byWorkspace.delete(workspace);
    return strip.clear();
  }

  /**
   * Puts the strips in the order of the workspaces; strips of workspaces that the order does not
   * name keep their place after the others.
   * @param order - The workspaces in their order.
   */
  order(order: readonly string[]): void {
    const sorted = [...this.byWorkspace].toSorted(([a], [b]) => rank(order, a) - rank(order, b));
    this.byWorkspace.clear();
    for (const [workspace, strip] of sorted) this.byWorkspace.set(workspace, strip);
  }

  override get all(): readonly T[] {
    return this.shownStrip.all;
  }

  override get strips(): readonly TabStrip<T>[] {
    return [...this.byWorkspace.values()];
  }

  override get active(): T | undefined {
    return this.shownStrip.active;
  }

  override get shown(): readonly string[] {
    return this.shownStrip.shown;
  }

  override get splits(): readonly SplitPair[] {
    return this.shownStrip.splits;
  }

  override get listed(): readonly T[] {
    return this.shownStrip.listed;
  }

  override get pinnedCount(): number {
    return this.shownStrip.pinnedCount;
  }

  override get canReopen(): boolean {
    return this.shownStrip.canReopen;
  }

  override withShown(make: (strip: TabStrip<T>) => TabStrip<T>): TabStrip<T> {
    const made = make(this.shownStrip);
    made.workspace = this.workspace;
    this.byWorkspace.set(this.workspace, made);
    return this;
  }

  override splitOf(id: string): SplitPair | undefined {
    return this.stripOf(id)?.splitOf(id);
  }

  override get(id: string): T | undefined {
    return this.stripOf(id)?.get(id);
  }

  override has(id: string): boolean {
    return this.stripOf(id) !== undefined;
  }

  override indexOf(id: string): number {
    return this.stripOf(id)?.indexOf(id) ?? -1;
  }

  override unitOf(id: string): readonly string[] {
    return this.stripOf(id)?.unitOf(id) ?? [];
  }

  /** Shows two tabs side by side, which must be in the same workspace. */
  override split(keep: string, add: string, ratio?: number): boolean {
    const strip = this.stripOf(keep);
    return strip !== undefined && strip.has(add) && strip.split(keep, add, ratio);
  }

  override unsplit(id: string): boolean {
    return this.stripOf(id)?.unsplit(id) ?? false;
  }

  override swapSplit(id: string): boolean {
    return this.stripOf(id)?.swapSplit(id) ?? false;
  }

  override resizeSplit(id: string, ratio: number): boolean {
    return this.stripOf(id)?.resizeSplit(id, ratio) ?? false;
  }

  /** Puts a new tab in the strip of the tab that opened it or that it follows, or the shown one. */
  override insert(tab: T, options: StripPlace): void {
    const strip =
      this.stripOf(options.opener ?? '') ?? this.stripOf(options.after ?? '') ?? this.shownStrip;
    strip.insert(tab, options);
  }

  /** Makes a tab its strip's active tab; whether the window shows another tab now. */
  override activate(id: string): boolean {
    const strip = this.stripOf(id);
    return strip !== undefined && strip.activate(id) && strip === this.shownStrip;
  }

  override close(id: string, keep?: boolean, history?: TabHistory): ClosedTab<T> | undefined {
    return this.stripOf(id)?.close(id, keep, history);
  }

  override forgetHistories(): void {
    for (const strip of this.byWorkspace.values()) strip.forgetHistories();
  }

  override reopenWith(open: (url: string, place: ReopenPlace) => string): string | undefined {
    return this.shownStrip.reopenWith(open);
  }

  override move(id: string, index: number): void {
    this.stripOf(id)?.move(id, index);
  }

  override step(id: string, direction: -1 | 1): boolean {
    return this.stripOf(id)?.step(id, direction) ?? false;
  }

  override pin(id: string, pinned: boolean): void {
    this.stripOf(id)?.pin(id, pinned);
  }

  override replace(tab: T): void {
    this.stripOf(tab.id)?.replace(tab);
  }

  override clear(): T[] {
    return [...this.byWorkspace.values()].flatMap((strip) => strip.clear());
  }
}

/** The place of a workspace in an order; those that it does not name come last. */
function rank(order: readonly string[], workspace: string): number {
  const index = order.indexOf(workspace);
  return index === -1 ? order.length : index;
}

/**
 * The strips of the workspaces of a window, which take the place of its plain strip the first
 * time; the strip that the window had stays the strip of the workspace that it shows.
 * @param tabs - The tabs of the window.
 */
export function workspaceStrips(tabs: TabService): WorkspaceStrips<Tab> {
  let strips: WorkspaceStrips<Tab> | undefined;
  tabs.useStrip((strip) => {
    strips = strip instanceof WorkspaceStrips ? strip : new WorkspaceStrips(strip);
    return strips;
  });
  if (strips === undefined) throw new Error('The strip of the tabs took no workspaces');
  return strips;
}

/**
 * Shows the tabs of another workspace in a window: the views of the pages that showed leave the
 * window and stay alive, and the active tab of the workspace shows with its split view, or a new
 * tab when the workspace has none yet. A workspace that tabs moved into before it ever showed
 * has no active tab, and shows the first of them.
 * @param tabs - The tabs of the window.
 * @param workspace - The workspace.
 * @returns Whether the window shows another workspace now.
 */
export function switchWorkspace(tabs: TabService, workspace: string): boolean {
  if (tabs.workspace === workspace) return false;
  const strips = workspaceStrips(tabs);
  tabs.edit(() => {
    strips.show(workspace);
    const strip = strips.shownStrip;
    const first = strip.active === undefined ? strip.listed[0] : undefined;
    if (first !== undefined) strip.activate(first.id);
  });
  return true;
}

/**
 * Shows a tab of a window, such as one that tab search or the suggestions of the address bar
 * found: the tab becomes the active tab of its workspace, whose group shows its tabs for it, and
 * the window shows that workspace. No other tab of the workspace loads on the way.
 * @param tabs - The tabs of the window.
 * @param id - The tab.
 */
export function revealTab(tabs: TabService, id: TabId): void {
  const workspace = tabs.workspaceOf(id);
  if (workspace === undefined) return;
  tabs.activate(id);
  switchWorkspace(tabs, workspace);
}

/**
 * Moves a tab of a window into another workspace, at the end of its pinned tabs or of its other
 * tabs, outside every group. The tab leaves its split view and its group, and its view stays as
 * it is. Where the tab was active, the nearest tab of its workspace becomes active, and a shown
 * workspace that has no tab left gets a new tab.
 * @param tabs - The tabs of the window.
 * @param id - The tab.
 * @param workspace - The workspace that it moves into.
 * @returns Whether the tab moved.
 */
export function moveToWorkspace(tabs: TabService, id: TabId, workspace: string): boolean {
  const from = tabs.workspaceOf(id);
  if (from === undefined || from === workspace) return false;
  const strips = workspaceStrips(tabs);
  tabs.edit(() => {
    const source = strips.stripOf(id);
    const closed = source?.close(id, false);
    if (source === undefined || closed === undefined) return;
    if (closed.next !== undefined) source.activate(closed.next.id);
    append(strips.strip(workspace), { ...closed.tab, group: null });
  });
  return true;
}

/**
 * Puts a tab at the end of the pinned tabs or of the other tabs of a strip, outside every group.
 * @param strip - The strip.
 * @param tab - The tab.
 */
function append(strip: TabStrip<Tab>, tab: Tab): void {
  strip.insert(tab, { activate: false });
  if (strip instanceof GroupedTabStrip) strip.move(tab.id, strip.all.length, null);
  else strip.move(tab.id, strip.all.length);
}

/**
 * Closes the tabs of a workspace in a window and takes its strip away. A window that shows the
 * workspace shows another one first.
 * @param tabs - The tabs of the window.
 * @param workspace - The workspace.
 * @param fallback - The workspace that the window shows instead.
 */
export function removeWorkspace(tabs: TabService, workspace: string, fallback: string): void {
  const holds = tabs.allTabs.some((tab) => tabs.workspaceOf(tab.id) === workspace);
  if (tabs.workspace !== workspace && !holds) return;
  if (tabs.workspace === workspace) switchWorkspace(tabs, fallback);
  const strips = workspaceStrips(tabs);
  tabs.edit(() => strips.drop(workspace));
}

/**
 * Puts the tabs of every workspace of a window into one workspace, workspace by workspace in an
 * order, as when workspaces are turned off: pinned tabs come first, and each group and split view
 * stays, with the tabs of its own workspace. The tab that the window shows stays active.
 * @param tabs - The tabs of the window.
 * @param into - The workspace that keeps the tabs.
 * @param order - The workspaces in their order.
 */
export function mergeWorkspaces(tabs: TabService, into: string, order: readonly string[]): void {
  if (tabs.workspace === into && tabs.allTabs.every((tab) => tabs.workspaceOf(tab.id) === into)) {
    return;
  }
  const strips = workspaceStrips(tabs);
  const active = tabs.active?.id;
  strips.order(order);
  tabs.edit(() => {
    strips.show(into);
    const moved = strips.workspaces
      .filter((workspace) => workspace !== into)
      .map((workspace) => {
        const strip = strips.strip(workspace);
        const pairs = strip.splits;
        const list = strip.clear();
        strips.drop(workspace);
        return { list, pairs };
      });
    const target = moved.some(({ list }) => list.some((tab) => tab.group !== null))
      ? groupedOf(strips, strips.strip(into))
      : strips.strip(into);
    for (const { list, pairs } of moved) {
      for (const tab of list) append(target, { ...tab, group: null });
      formGroups(target, list);
      for (const pair of pairs) target.split(pair.start, pair.end, pair.ratio);
    }
    if (active !== undefined && target.has(active)) target.activate(active);
  });
}

/** The strip of a workspace with groups, which takes the place of a plain one. */
function groupedOf(strips: WorkspaceStrips<Tab>, strip: TabStrip<Tab>): GroupedTabStrip<Tab> {
  if (strip instanceof GroupedTabStrip) return strip;
  const grouped = new GroupedTabStrip(strip);
  strips.setStrip(grouped);
  return grouped;
}

/**
 * Forms the groups of some tabs again in a strip, with new ids: neighbouring tabs that had the
 * same group form it, so that groups of other workspaces never join theirs.
 * @param strip - The strip, which holds the tabs next to each other.
 * @param tabs - The tabs as they were, with their groups.
 */
function formGroups(strip: TabStrip<Tab>, tabs: readonly Tab[]): void {
  if (!(strip instanceof GroupedTabStrip)) return;
  const runs: { ids: TabId[]; group: TabGroup }[] = [];
  tabs.forEach((tab, at) => {
    const last = runs.at(-1);
    if (tab.pinned || tab.group === null) return;
    if (
      last !== undefined &&
      tabs[at - 1]?.id === last.ids.at(-1) &&
      last.group.id === tab.group.id
    ) {
      last.ids.push(tab.id);
    } else {
      runs.push({ ids: [tab.id], group: tab.group });
    }
  });
  for (const run of runs) strip.formGroup(run.ids, run.group);
}

/**
 * Opens the tabs of restored windows in their workspaces, as `WindowManager.restore` asks for
 * each window, with the workspaces of the profile in their order.
 * @param order - The workspaces of the profile, or none while workspaces are off.
 */
export function workspaceRestore(
  order: readonly string[],
): (tabs: TabService, window: RestoredWindow, splitView: boolean, regroup?: Regroup) => void {
  return (tabs, window, splitView, regroup) =>
    restoreWorkspaceTabs(tabs, window, { order, splitView, regroup });
}

/** Forms the groups of some restored tabs again, as `restoreGroups` of `tab-groups.ts` does. */
type Regroup = (
  tabs: TabService,
  ids: readonly TabId[],
  groups: readonly (TabGroup | undefined)[],
) => void;

/** What the restore of a window with workspaces needs besides its tabs. */
export interface WorkspaceRestore {
  /**
   * The workspaces of the profile in their order; tabs of other workspaces, or of every one
   * while the list is empty, as when workspaces are off, come back in the default workspace.
   */
  readonly order: readonly string[];
  /** Whether the window may show split views. */
  readonly splitView: boolean;
  /** Forms the groups of some restored tabs again, as `restoreGroups` of `tab-groups.ts` does. */
  readonly regroup?: Regroup | undefined;
}

/**
 * Opens the tabs of a restored window again in their workspaces, each workspace with its groups,
 * its split views and its active tab, and shows the workspace that the window showed. Only the
 * active tab of that workspace loads, with the other tab of its split view; the others load once
 * they show. Tabs of workspaces that the profile no longer has come back in the default one, and
 * so does every tab while workspaces are off, after the tabs of the default workspace; their
 * groups and split views stay with the tabs of their own workspace.
 * @param tabs - The tabs of the window, which has none yet.
 * @param window - The window as the session kept it.
 * @param options - The workspaces of the profile and what else the restore needs.
 */
export function restoreWorkspaceTabs(
  tabs: TabService,
  window: RestoredWindow,
  options: WorkspaceRestore,
): void {
  const known = (workspace: string | undefined): string =>
    workspace !== undefined && options.order.includes(workspace) ? workspace : defaultWorkspaceId;
  const shown = known(window.workspace);
  // The tabs of each workspace of the file, in the order of the file; the default one first.
  const kept = new Map<string, number[]>([[defaultWorkspaceId, []]]);
  window.tabs.forEach((tab, index) => {
    const workspace = tab.workspace ?? defaultWorkspaceId;
    const list = kept.get(workspace) ?? [];
    list.push(index);
    kept.set(workspace, list);
  });
  const active = window.tabs[window.active] === undefined ? 0 : window.active;
  const strips =
    shown === tabs.workspace && [...kept.keys()].every((workspace) => known(workspace) === shown)
      ? undefined
      : workspaceStrips(tabs);
  const ids: TabId[] = [];
  const currents = new Map<string, TabId>();
  for (const [workspace, indices] of kept) {
    const target = known(workspace);
    strips?.show(target);
    for (const index of indices) {
      const tab = window.tabs[index];
      if (tab === undefined) continue;
      const id = tabs.open(tab.url, {
        activate: false,
        lazy: !(target === shown && index === active),
        title: tab.title,
        pinned: tab.pinned === true,
        history: tab.history,
      });
      ids[index] = id;
      if (target === shown ? index === active : tab.current === true && !currents.has(target)) {
        currents.set(target, id);
      }
    }
    options.regroup?.(
      tabs,
      indices.flatMap((index) => ids[index] ?? []),
      indices.flatMap((index) => (ids[index] === undefined ? [] : [window.tabs[index]?.group])),
    );
    for (const pair of options.splitView ? (window.splits ?? []) : []) {
      const [start, end] = [ids[pair.start], ids[pair.start + 1]];
      if (start === undefined || end === undefined) continue;
      if (indices.includes(pair.start) && indices.includes(pair.start + 1)) {
        tabs.split(start, end, pair.ratio);
      }
    }
  }
  strips?.show(shown);
  // Each workspace that does not show keeps its active tab, which shows once it does.
  for (const workspace of strips?.workspaces ?? []) {
    const current = currents.get(workspace) ?? strips?.strip(workspace).listed[0]?.id;
    if (workspace !== shown && current !== undefined) tabs.activate(current);
  }
  const first = currents.get(shown) ?? tabs.listed[0]?.id;
  if (first === undefined) tabs.open();
  else tabs.activate(first);
}
