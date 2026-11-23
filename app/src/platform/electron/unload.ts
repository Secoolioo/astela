import type { WebContents } from 'electron';

/**
 * Why a page that asks to stay is to unload, which its question names: people leave it for
 * another page, as with the address bar, Back or a link, reload it, or close its tab.
 */
export type UnloadReason = 'leave' | 'reload' | 'close';

/** The pages that the browser reloads or closes, until they answered whether they may unload. */
const reasons = new WeakMap<WebContents, 'reload' | 'close'>();
/** The pages whose tab people closed after the page asked to stay. */
const leaving = new WeakSet<WebContents>();
/** The pages whose dialog waits for its answer, which cannot run meanwhile. */
const waiting = new WeakSet<WebContents>();

/**
 * Notes that the browser reloads a page or closes its tab, which the page may ask to stay for.
 * @param contents - The page.
 * @param reason - Why it unloads.
 */
export function unloading(contents: WebContents, reason: 'reload' | 'close'): void {
  reasons.set(contents, reason);
}

/**
 * Why a page that asks to stay unloads: what the browser noted last, which it forgets now, or
 * else people leave it.
 * @param contents - The page.
 */
export function unloadReason(contents: WebContents): UnloadReason {
  const reason = reasons.get(contents) ?? 'leave';
  reasons.delete(contents);
  return reason;
}

/**
 * Forgets why a page was to unload, once it started to load another document without asking.
 * @param contents - The page.
 */
export function unloaded(contents: WebContents): void {
  reasons.delete(contents);
}

/**
 * Notes that people closed the tab of a page after it asked to stay, so that it closes without
 * asking again while it goes.
 * @param contents - The page.
 */
export function leave(contents: WebContents): void {
  leaving.add(contents);
}

/**
 * Whether people closed the tab of a page after it asked to stay.
 * @param contents - The page.
 */
export function isLeaving(contents: WebContents): boolean {
  return leaving.has(contents);
}

/**
 * Notes whether a dialog of a page waits for its answer, such as `alert()` or `prompt()`: the
 * page cannot run meanwhile, so it neither answers whether it may unload nor hangs.
 * @param contents - The page.
 * @param waits - Whether a dialog waits.
 */
export function waitForAnswer(contents: WebContents, waits: boolean): void {
  if (waits) waiting.add(contents);
  else waiting.delete(contents);
}

/**
 * Whether a dialog of a page waits for its answer.
 * @param contents - The page.
 */
export function waitsForAnswer(contents: WebContents): boolean {
  return waiting.has(contents);
}
