import type { TabHistory } from '../tabs/view-history.ts';
import { sessionBudget, type SessionSnapshot } from './session.ts';

/** How many characters the page states of a history hold. */
function pageStates(history: TabHistory | undefined): number {
  let size = 0;
  for (const view of history?.views ?? []) {
    for (const entry of view.entries) size += entry.pageState?.length ?? 0;
  }
  return size;
}

/**
 * A history without the page states of some of its entries.
 * @param history - The history.
 * @param drops - Whether the page state of the entry at an index of a view goes.
 */
function withoutStates(
  history: TabHistory,
  drops: (view: number, index: number) => boolean,
): TabHistory {
  return {
    views: history.views.map((view, at) => ({
      entries: view.entries.map((entry, index) =>
        entry.pageState !== undefined && drops(at, index)
          ? { url: entry.url, title: entry.title }
          : entry,
      ),
      index: view.index,
    })),
    view: history.view,
  };
}

/**
 * Fits the page states of a session into a budget. First the page states of the entries that
 * the tabs do not show go, tab by tab, those of tabs that are not active first; then those of
 * the entries that tabs which are not active show. What the active tabs show stays.
 * @param session - The session.
 * @param budget - How many characters of page states the session may have.
 * @returns The session, the same object when it fits.
 */
export function fitSession(
  session: SessionSnapshot,
  budget: number = sessionBudget,
): SessionSnapshot {
  const histories = session.windows.map((window) => window.tabs.map((tab) => tab.history));
  let total = histories.flat().reduce((sum, history) => sum + pageStates(history), 0);
  if (total <= budget) return session;
  const places = session.windows.flatMap((window, at) =>
    window.tabs.map((_, tab) => ({ window: at, tab, active: tab === window.active })),
  );
  const inactive = places.filter((place) => !place.active);
  /** Drops page states of a tab: of the entries that it does not show, or of all. */
  const drop = (place: { window: number; tab: number }, all: boolean): void => {
    const tabs = histories[place.window];
    const history = tabs?.[place.tab];
    if (tabs === undefined || history === undefined) return;
    const shown = history.views[history.view]?.index;
    const next = withoutStates(
      history,
      (view, index) => all || view !== history.view || index !== shown,
    );
    total -= pageStates(history) - pageStates(next);
    tabs[place.tab] = next;
  };
  for (const place of [...inactive, ...places.filter((candidate) => candidate.active)]) {
    if (total <= budget) break;
    drop(place, false);
  }
  for (const place of inactive) {
    if (total <= budget) break;
    drop(place, true);
  }
  return {
    version: session.version,
    windows: session.windows.map((window, at) =>
      Object.assign({}, window, {
        tabs: window.tabs.map((tab, index) => {
          const history = histories[at]?.[index];
          return history === undefined ? tab : Object.assign({}, tab, { history });
        }),
      }),
    ),
  };
}
