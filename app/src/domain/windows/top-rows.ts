import type { ToolbarPlacement } from '../../shared/layout.ts';
import { titleBarArea, type Density, type TabStripSide } from './title-bar.ts';

/**
 * How long the rows that hide show after the visible tab changes or shows another site, in
 * milliseconds, so that people see which site a page belongs to.
 */
export const peekTime = 1500;

/**
 * The edge that stays of rows that hide at each density, in CSS pixels: the room above the
 * tabs, `--space-1`.
 */
const edges: Readonly<Record<Density, number>> = { compact: 2, normal: 4, comfortable: 4 };

/**
 * What holds rows that hide open: the pointer over them, the focus in the shell, the find bar,
 * a popover of a button of the shell, a native menu of the shell, and the moment after the
 * visible tab changed or showed another site.
 */
export interface RowHolds {
  readonly pointer: boolean;
  readonly focus: boolean;
  readonly find: boolean;
  readonly popover: boolean;
  readonly menu: boolean;
  readonly peek: boolean;
}

/** What decides whether the rows of a window hide. */
export interface TopRowsInput {
  /** The operating system, as `process.platform` names it. */
  readonly platform: string;
  readonly density: Density;
  /** Where the tab strip is. */
  readonly tabStrip: TabStripSide;
  /** Where the settings put the toolbar. */
  readonly placement: ToolbarPlacement;
  /** Whether the settings hide the tabs and the toolbar until they are needed. */
  readonly autoHide: boolean;
  /** Whether the window is a popup that a page opened. */
  readonly popup: boolean;
  /** Whether the window draws its own title bar, with the window controls in its top row. */
  readonly integrated: boolean;
  /** Whether the window is in full screen, where the system hides the window controls. */
  readonly windowFullScreen: boolean;
  /** Whether a page shows an element in full screen, which covers the whole window. */
  readonly pageFullScreen: boolean;
  /**
   * Whether the pages that the content area shows cover it: each shown tab has a view and no
   * problem, which the shell would show in its place.
   */
  readonly pageCovers: boolean;
  readonly holds: RowHolds;
}

/**
 * Rows that hide: whether they show now; what stays of them while they hide, an `edge` of the
 * window's color or, where the system draws the window controls into the top row, a `title`
 * row with the site for them; and how high that is, which is where the page starts.
 */
export interface RowsHiding {
  readonly shown: boolean;
  readonly rest: 'edge' | 'title';
  readonly height: number;
}

/**
 * Whether the tabs and the toolbar of a window hide, or `null` while they always show. They
 * hide only with the tabs at the top and never in a popup, whose page expects to show its
 * address. On macOS, and with the system's title bar or in full screen, an edge of the window's
 * color stays; on Windows and Linux with the browser's title bar, a title row of the height of
 * the top row stays, as Chromium draws the window controls there and cannot hide them. The rows
 * show while a page does not cover the content area, and while something holds them, but never
 * over a page in full screen.
 * @param input - The settings and the state of the window.
 */
export function rowsHiding(input: TopRowsInput): RowsHiding | null {
  if (!input.autoHide || input.tabStrip !== 'top' || input.popup) return null;
  const rest =
    input.integrated && input.platform !== 'darwin' && !input.windowFullScreen ? 'title' : 'edge';
  const height =
    rest === 'title'
      ? titleBarArea(input.platform, input.density, { side: 'top', toolbar: input.placement })
          .height
      : edges[input.density];
  const held = Object.values(input.holds).some(Boolean);
  return { shown: !input.pageFullScreen && (!input.pageCovers || held), rest, height };
}

/** Whether two states of rows that hide are the same. */
export function sameHiding(a: RowsHiding | null, b: RowsHiding | null): boolean {
  return (
    a === b ||
    (a !== null && b !== null && a.shown === b.shown && a.rest === b.rest && a.height === b.height)
  );
}

/**
 * The part of an address that names its site for the moment the rows show: its scheme with
 * its host and port, such as `https://example.com:8443`, or the scheme alone for an address
 * without a host, such as `about:`.
 * @param url - The address of a page.
 */
export function siteOfPage(url: string): string {
  const match = /^([a-z][a-z\d+.-]*:)(\/\/[^/?#]*)?/i.exec(url);
  return match === null ? url : `${match[1] ?? ''}${match[2] ?? ''}`.toLowerCase();
}
