/**
 * The pop-ups that a page opened without a click, until it goes to another document: how many in
 * all, and the addresses of the latest ones, which people can open. The page decides how many
 * there are and how long their addresses are, so the list keeps at most `limit` of them, and no
 * address longer than `longest`, which only counts.
 */
export class BlockedPopups {
  private readonly listed: string[] = [];
  private blocked = 0;
  private readonly limit: number;
  private readonly longest: number;

  /**
   * @param limit - How many addresses the list keeps at most: the latest ones.
   * @param longest - The longest address that the list keeps, in characters.
   */
  constructor(limit: number, longest: number) {
    this.limit = limit;
    this.longest = longest;
  }

  /** How many pop-ups the page opened without a click. */
  get count(): number {
    return this.blocked;
  }

  /** The addresses that people can open, in the order in which they were blocked. */
  get urls(): readonly string[] {
    return this.listed;
  }

  /**
   * Takes note of a pop-up that was blocked.
   * @param url - Its address.
   */
  add(url: string): void {
    this.blocked += 1;
    if (url.length > this.longest) return;
    this.listed.push(url);
    if (this.listed.length > this.limit) this.listed.shift();
  }

  /**
   * Takes a pop-up that people open out of the list: it is no longer blocked. Once the list is
   * empty, nothing is left to open, and the count ends as well.
   * @param url - Its address.
   * @returns Whether the list had it.
   */
  open(url: string): boolean {
    const index = this.listed.indexOf(url);
    if (index === -1) return false;
    this.listed.splice(index, 1);
    this.blocked = this.listed.length === 0 ? 0 : this.blocked - 1;
    return true;
  }

  /**
   * Forgets the pop-ups, as the page goes to another document.
   * @returns Whether there were any.
   */
  clear(): boolean {
    if (this.blocked === 0) return false;
    this.listed.length = 0;
    this.blocked = 0;
    return true;
  }
}
