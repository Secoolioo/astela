import type { TabHistory } from './view-history.ts';

// How Back and Forward step through the history of a tab without a view. Only the buttons
// and commands of such a tab read this, not the start of the browser, which reads the
// histories of a session and their limits.

/**
 * The history after a step back or forward, as Back and Forward take it: within the view, or
 * into the view before or after it, at the entry that view showed.
 * @param history - The tab's history.
 * @param direction - -1 for Back, 1 for Forward.
 * @returns The history, or `undefined` at its start or its end.
 */
export function stepHistory(history: TabHistory, direction: -1 | 1): TabHistory | undefined {
  const view = history.views[history.view];
  if (view === undefined) return undefined;
  const index = view.index + direction;
  if (index >= 0 && index < view.entries.length) {
    return { views: history.views.with(history.view, { ...view, index }), view: history.view };
  }
  const next = history.view + direction;
  return next >= 0 && next < history.views.length ? { ...history, view: next } : undefined;
}
