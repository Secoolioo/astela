/**
 * The icons of the pages that the tabs of a window show, by their keys. The shell asks the
 * browser for an icon when a tab first shows its key, and keeps it only while a tab shows
 * it, so that a page whose icon keeps changing does not fill the shell's memory.
 */
export class TabIcons {
  /** Icons by key, `undefined` while the browser is asked for one. */
  private readonly icons = new Map<string, string | undefined>();
  private readonly ask: (key: string) => Promise<string | null>;
  private readonly arrived: () => void;

  /**
   * @param ask - Asks the browser for the icon of a key; `null` if it has none.
   * @param arrived - Called when an icon arrived, so that the tabs show it.
   */
  constructor(ask: (key: string) => Promise<string | null>, arrived: () => void) {
    this.ask = ask;
    this.arrived = arrived;
  }

  /**
   * The icon of a key as a `data:` address, once the browser sent it; the first call asks.
   * A key that the browser had no icon for, or whose question failed, is asked for again the
   * next time that a tab shows it.
   * @param key - The key of the icon.
   */
  get(key: string): string | undefined {
    if (!this.icons.has(key)) {
      this.icons.set(key, undefined);
      void this.ask(key).then(
        (icon) => this.answer(key, icon),
        () => this.answer(key, null),
      );
    }
    return this.icons.get(key);
  }

  /**
   * Forgets the icons that no tab shows any more.
   * @param keys - The keys of the icons of the tabs.
   */
  keep(keys: Iterable<string>): void {
    const kept = new Set(keys);
    for (const key of this.icons.keys()) {
      if (!kept.has(key)) this.icons.delete(key);
    }
  }

  private answer(key: string, icon: string | null): void {
    // The answer for a key that no tab shows any more is not kept.
    if (!this.icons.has(key) || this.icons.get(key) !== undefined) return;
    if (icon === null) {
      this.icons.delete(key);
      return;
    }
    this.icons.set(key, icon);
    this.arrived();
  }
}
