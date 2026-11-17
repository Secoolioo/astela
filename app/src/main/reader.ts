import { WebContentsView, type WebContents } from 'electron';
import * as v from 'valibot';
import type { Logger } from '../kernel/logging/logger.ts';
import { isAccentPreset, presetAccentColors } from '../domain/appearance/accent-presets.ts';
import { webFontPreferences } from '../domain/appearance/appearance.ts';
import { mayOpenInNewTab } from '../domain/navigation/new-tab.ts';
import { ReaderArticle } from '../domain/reader/article-schema.ts';
import {
  fitReaderDocument,
  longDate,
  readerColors,
  readerZoomCss,
  type ReaderLook,
  type ReaderTexts,
} from '../domain/reader/document.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { TabId } from '../domain/tabs/tab-service.ts';
import type {
  BrowserWindowController,
  CoverEnd,
  PageEvent,
  TabCover,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import { builtInThemes, themeColors } from '../shared/themes.ts';
import { zoomFactors } from '../shared/zoom.ts';
import {
  AccentSetting,
  CustomThemeSetting,
  DefaultZoomSetting,
  ReaderEnabledSetting,
  ReaderFontSetting,
  ThemeSetting,
  UiFontSetting,
  WebFontsSetting,
  WebTextSizeSetting,
} from './core-settings.ts';
import { translatorFor } from './i18n/i18n.ts';
import { PageScripts } from './page-scripts.ts';
import { uiLocale } from './ui-language.ts';
import { windowBackground } from './window-background.ts';

/** What the reader view needs from the browser process. */
export interface ReaderDependencies {
  readonly windows: WindowManager;
  readonly settings: SettingsService;
  /** The folder of the scripts that the browser runs in web pages. */
  readonly scripts: string;
  readonly logger: Logger;
}

/** The answer of the page script to a check. */
const CheckAnswer = v.strictObject({ readable: v.boolean() });

/** The answer of the page script to an extraction. */
const ExtractAnswer = v.strictObject({ article: v.nullable(ReaderArticle) });

/** How long a check may take, in milliseconds, also when it waits for the page to load. */
const checkTime = 5000;
/** How long an extraction may take, in milliseconds. */
const extractTime = 10_000;
/** How long a page that changes its address with the History API stays quiet before a check. */
const quietTime = 1000;

/** The settings that change how an open reader view looks. */
const lookKeys = new Set([
  ThemeSetting.key,
  CustomThemeSetting.key,
  AccentSetting.key,
  UiFontSetting.key,
  ReaderFontSetting.key,
]);

/**
 * The reader view, which loads with the first web page that loads in the active tab while it is
 * on. It checks the page of the active tab once its main frame has loaded, with the reader's
 * script in the browser's isolated world, and marks the tab when the page has an article. On
 * request, it reads the article there, checks it against the schema of an article, writes it
 * as a document without scripts in the colors and fonts of the browser, and shows that
 * document in a view of the page's session that covers the tab. The page stays as it was, and
 * comes back when the reader view ends. Nothing of the article is stored or logged.
 */
export class ReaderController {
  private readonly windows: WindowManager;
  private readonly settings: SettingsService;
  private readonly logger: Logger;
  private readonly scripts: PageScripts;
  /** The address without its fragment at which each page was checked last, until it loads again. */
  private checked = new WeakMap<WebContents, string>();
  /** The checks that wait for a page that changed its address to be quiet. */
  private readonly changes = new Map<WebContents, NodeJS.Timeout>();
  /**
   * The address of the page of a tab whose reader view was open when the page loaded again,
   * such as after a reload, or when the tab went to sleep: the next check of the tab's page
   * opens it again if the page has the same address, also in the view of a tab that woke.
   */
  private wanted = new WeakMap<BrowserWindowController, Map<TabId, string>>();
  /** The pages whose reader view is being made. */
  private readonly opening = new WeakSet<WebContents>();
  /** The reader views that show. */
  private readonly covers = new Set<ReaderCover>();
  /**
   * The contents of the reader views, with the address of the page under each: the content
   * blocker answers them with no rules, and judges their requests by that page.
   */
  private readonly views = new WeakMap<WebContents, string>();

  /** @param deps - What the reader view needs. */
  constructor(deps: ReaderDependencies) {
    this.windows = deps.windows;
    this.settings = deps.settings;
    this.logger = deps.logger;
    this.scripts = new PageScripts(deps.scripts);
    deps.settings.onDidChange(({ keys }) => {
      if (keys.includes(ReaderEnabledSetting.key)) {
        if (this.on()) this.checkActiveTabs();
        else this.turnOff();
      }
      if (keys.some((key) => lookKeys.has(key))) void this.restyle();
    });
    this.checkActiveTabs();
  }

  /**
   * The address of the page whose article a reader view shows, or `undefined` for a page that
   * is no reader view. The frame of a reader view gets no rules of the content blocker, and its
   * pictures load by the rules of that page, as on the page.
   * @param contents - The page.
   */
  pageOf(contents: WebContents): string | undefined {
    return this.views.get(contents);
  }

  /**
   * Takes note of what happened to the web page of a tab: once its main frame has loaded and
   * when its tab is shown, the active tab's page is checked for an article, once per address
   * without its fragment; a page that changed its address with the History API is checked
   * again after a quiet second.
   * @param window - The window of the tab.
   * @param id - The tab.
   * @param contents - Its page.
   * @param event - What happened.
   */
  page(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
    event: Exclude<PageEvent, 'media'>,
  ): void {
    if (!this.on()) return;
    if (event === 'changed') {
      this.checked.delete(contents);
      clearTimeout(this.changes.get(contents));
      this.changes.set(
        contents,
        setTimeout(() => {
          this.changes.delete(contents);
          void this.check(window, id, contents);
        }, quietTime),
      );
      return;
    }
    if (event === 'loaded') this.checked.delete(contents);
    // A page that is shown while its main frame loads is checked once it has loaded. Frames
    // that load later, such as those that scripts add after the load, hold nothing back: the
    // isolated world waits only for the main frame.
    else if (contents.isLoadingMainFrame()) return;
    void this.check(window, id, contents);
  }

  /**
   * Shows the reader view of a tab whose page has an article, or ends the one that shows.
   * @param window - The window.
   * @param id - The tab.
   */
  async toggle(window: BrowserWindowController, id: TabId): Promise<void> {
    if (!this.on()) return;
    if (this.coverOf(window, id) !== undefined) {
      window.uncover(id, 'closed');
      // The page takes the focus, as after the buttons of the toolbar, also from the button
      // that ended the reader view. A window in the background stays there.
      if (window.tabs.active?.id === id && window.window.isFocused()) window.focusContent();
      return;
    }
    const contents = window.webContentsOf(id);
    if (contents !== undefined && window.tabs.get(id)?.reader === 'available') {
      await this.open(window, id, contents, true);
    }
  }

  /**
   * Takes note that a reader view ended: its view closes, and its tab shows that its page has
   * an article. After a reload, and once a tab that went to sleep has woken, the next check of
   * the page opens the reader view again.
   * @param cover - The reader view.
   * @param end - Why it ended.
   */
  ended(cover: ReaderCover, end: CoverEnd): void {
    this.covers.delete(cover);
    const { window, id, page, view } = cover;
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (page.isDestroyed()) return;
    // The page loaded its address again, as after Reload, or the page itself did, or the tab
    // goes to sleep, and loads the page again when it wakes.
    const again =
      end === 'reloaded' ||
      end === 'slept' ||
      (end === 'navigated' && withoutHash(page.getURL()) === withoutHash(cover.address));
    if (again && this.on()) this.want(window, id, withoutHash(cover.address));
    if (window.webContentsOf(id) === page) {
      const gone = end === 'gone' || end === 'slept' || !this.on();
      window.tabs.update(id, { reader: gone ? 'none' : 'available' });
    }
  }

  /** The default zoom of pages, which the reset of a reader view's zoom goes back to. */
  defaultZoom(): number {
    return this.settings.get(DefaultZoomSetting);
  }

  /** Whether the reader view is on, which a setting or a policy can turn off. */
  private on(): boolean {
    return this.settings.get(ReaderEnabledSetting);
  }

  /**
   * Takes note that the next check of a tab's page opens the reader view at an address, and
   * forgets the tabs of the window that closed meanwhile.
   */
  private want(window: BrowserWindowController, id: TabId, address: string): void {
    let tabs = this.wanted.get(window);
    if (tabs === undefined) {
      tabs = new Map();
      this.wanted.set(window, tabs);
    }
    for (const tab of tabs.keys()) if (window.tabs.get(tab) === undefined) tabs.delete(tab);
    tabs.set(id, address);
  }

  /** The reader view that shows over a tab's page, if any. */
  private coverOf(window: BrowserWindowController, id: TabId): ReaderCover | undefined {
    for (const cover of this.covers) if (cover.window === window && cover.id === id) return cover;
    return undefined;
  }

  /** Checks the page of the active tab of every window, as when the reader view turns on. */
  private checkActiveTabs(): void {
    if (!this.on()) return;
    for (const window of this.windows.all) {
      const active = window.tabs.active;
      const contents = active === undefined ? undefined : window.webContentsOf(active.id);
      if (active !== undefined && contents !== undefined)
        this.page(window, active.id, contents, 'shown');
    }
  }

  /**
   * Checks whether the page of the active tab has an article, once per address, and marks the
   * tab; a reader view that was open before the page loaded again opens again.
   */
  private async check(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
  ): Promise<void> {
    if (contents.isDestroyed() || window.webContentsOf(id) !== contents) return;
    if (window.tabs.active?.id !== id) return;
    const address = contents.getURL();
    const key = withoutHash(address);
    if (!/^https?:/i.test(address) || this.checked.get(contents) === key) return;
    this.checked.set(contents, key);
    // A reader view that was open comes back only with the next check of its page.
    const tabs = this.wanted.get(window);
    const wanted = tabs?.get(id);
    tabs?.delete(id);
    let readable: boolean;
    try {
      const answer = await this.scripts.inMainFrame(
        contents,
        'reader',
        { kind: 'check' },
        { timeoutMs: checkTime },
      );
      readable = v.parse(CheckAnswer, answer).readable;
    } catch (error) {
      if (this.checked.get(contents) === key) this.checked.delete(contents);
      this.logger.debug('A page could not be checked for the reader view', {
        error: errorName(error),
      });
      return;
    }
    // The page may have gone elsewhere meanwhile, or the reader view was turned off.
    if (!this.on() || contents.isDestroyed() || withoutHash(contents.getURL()) !== key) return;
    if (window.webContentsOf(id) !== contents || window.tabs.get(id)?.reader === 'open') return;
    window.tabs.update(id, { reader: readable ? 'available' : 'none' });
    if (readable && wanted === key) await this.open(window, id, contents, false);
  }

  /**
   * Reads the article of a page and shows it in a reader view over its tab. An answer for a
   * page that changed its address meanwhile, or an article that does not pass the schema, is
   * dropped.
   * @param asked - Whether a person asked for it; a reader view that comes back by itself, as
   *   after a reload, leaves the focus and the popovers of the window where they are.
   */
  private async open(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
    asked: boolean,
  ): Promise<void> {
    if (this.opening.has(contents)) return;
    this.opening.add(contents);
    try {
      const address = contents.getURL();
      const answer = await this.scripts.inMainFrame(
        contents,
        'reader',
        { kind: 'extract', until: Date.now() + extractTime },
        { timeoutMs: extractTime },
      );
      const parsed = v.safeParse(ExtractAnswer, answer);
      if (!parsed.success) {
        this.logger.warn('The article of a page did not pass its schema', {
          issues: parsed.issues.length,
        });
        return;
      }
      const article = parsed.output.article;
      const current = (): boolean =>
        this.on() &&
        !contents.isDestroyed() &&
        contents.getURL() === address &&
        window.webContentsOf(id) === contents &&
        this.coverOf(window, id) === undefined;
      if (article === null || !current()) return;
      const html = fitReaderDocument(article, await this.look(window.isPrivate), this.texts());
      const view = new WebContentsView({
        webPreferences: {
          // The reader's pictures load like the page's, with its content blocker and cookies.
          session: contents.session,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          spellcheck: false,
          navigateOnDragDrop: false,
          focusOnNavigation: false,
          ...webFontPreferences(
            this.settings.get(WebFontsSetting),
            this.settings.get(WebTextSizeSetting),
          ),
          zoomFactor: this.defaultZoom(),
        },
      });
      view.setBackgroundColor(windowBackground(window.isPrivate));
      const reader = view.webContents;
      this.views.set(reader, address);
      const cover = new ReaderCover(this, { window, id, page: contents, view, address, asked });
      // A link of the reader opens in its tab, which ends the reader view; a middle click and
      // the context menu open it in a new tab next to it, as links of the page do.
      reader.on('will-navigate', (event) => {
        event.preventDefault();
        if (mayOpenInNewTab(event.url) && this.covers.has(cover))
          window.tabs.navigate(id, event.url);
      });
      try {
        await reader.loadURL(
          `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`,
        );
      } catch (error) {
        // A view that could not load its document goes with its renderer.
        reader.close();
        throw error;
      }
      if (!current() || !window.cover(id, cover)) {
        reader.close();
        return;
      }
      this.covers.add(cover);
      window.tabs.update(id, { reader: 'open' });
      this.logger.debug('The reader view opened', { bytes: html.length });
    } catch (error) {
      this.logger.warn('The reader view did not open', { error: errorName(error) });
    } finally {
      this.opening.delete(contents);
    }
  }

  /** Gives every reader view the colors and the font of the settings now. */
  private async restyle(): Promise<void> {
    for (const cover of this.covers) {
      cover.restyle(readerColors(await this.look(cover.window.isPrivate)));
    }
  }

  /** Ends every reader view and forgets every article, as when the reader view turns off. */
  private turnOff(): void {
    // Each reader view leaves the set as it ends, which a loop over the set allows.
    for (const cover of this.covers) cover.window.uncover(cover.id, 'closed');
    for (const timer of this.changes.values()) clearTimeout(timer);
    this.changes.clear();
    this.checked = new WeakMap();
    this.wanted = new WeakMap();
    for (const window of this.windows.all) {
      for (const tab of window.tabs.allTabs) {
        if (tab.reader !== 'none') window.tabs.update(tab.id, { reader: 'none' });
      }
    }
  }

  /** How a reader view looks in a regular or a private window, as the settings say now. */
  private async look(privateWindow: boolean): Promise<ReaderLook> {
    const { settings } = this;
    const theme =
      themeColors(settings.get(ThemeSetting), settings.get(CustomThemeSetting)) ??
      builtInThemes.astela;
    const accent = settings.get(AccentSetting);
    return {
      light: theme.light,
      dark: theme.dark,
      // The color math of a custom accent loads with it, as for the browser's own views.
      accent: isAccentPreset(accent)
        ? presetAccentColors[accent]
        : (await import('../domain/appearance/accent.ts')).accentColors(accent),
      private: privateWindow,
      font: settings.get(ReaderFontSetting),
      uiFont: settings.get(UiFontSetting),
    };
  }

  /** The texts of the browser in a reader view, in the language of the browser. */
  private texts(): ReaderTexts {
    const locale = uiLocale();
    const i18n = translatorFor(locale, process.platform);
    return {
      lang: locale,
      readingTime: (minutes) => i18n.t('reader.readingTime', { minutes: String(minutes) }),
      truncated: i18n.t('reader.truncated'),
      date: (published) => longDate(published, locale),
    };
  }
}

/**
 * A reader view over the page of a tab: its view, and its zoom, which changes the text of the
 * document with a style sheet in the steps of page zoom. Chromium's own zoom of the view stays
 * at the default zoom that it was made with: it would keep a zoom for each `data:` address.
 */
export class ReaderCover implements TabCover {
  readonly window: BrowserWindowController;
  readonly id: TabId;
  /** The page that the reader view covers. */
  readonly page: WebContents;
  readonly view: WebContentsView;
  /** The address of the page whose article the reader view shows. */
  readonly address: string;
  readonly asked: boolean;
  private readonly controller: ReaderController;
  /** The default zoom of pages when the view was made, which Chromium keeps for it. */
  private readonly made: number;
  /** The zoom of the reader's text, 1 for its first size. */
  private text = 1;
  /** The style sheets of the zoom and of the colors that the browser added to the document. */
  private zoomSheet: Promise<string> | undefined;
  private colorSheet: Promise<string> | undefined;

  /**
   * @param controller - The reader view, which takes note when the cover ends.
   * @param where - The window, the tab and its page, the reader's view, the address of the page,
   *   and whether a person asked for the reader view.
   */
  constructor(
    controller: ReaderController,
    where: Pick<ReaderCover, 'window' | 'id' | 'page' | 'view' | 'address' | 'asked'>,
  ) {
    this.controller = controller;
    this.window = where.window;
    this.id = where.id;
    this.page = where.page;
    this.view = where.view;
    this.address = where.address;
    this.asked = where.asked;
    this.made = controller.defaultZoom();
  }

  /** The zoom that the tab shows: the default zoom that the view has, and that of its text. */
  get zoom(): number {
    return this.made * this.text;
  }

  zoomBy(direction: 1 | -1 | 0): void {
    const current = this.zoom;
    const target =
      direction === 0
        ? this.controller.defaultZoom()
        : direction > 0
          ? (zoomFactors.find((step) => step > current + 0.001) ?? current)
          : (zoomFactors.toReversed().find((step) => step < current - 0.001) ?? current);
    this.text = target / this.made;
    this.zoomSheet = this.replace(this.zoomSheet, readerZoomCss(this.text));
  }

  /**
   * Gives the document new colors and a new font.
   * @param css - The style sheet of `readerColors`.
   */
  restyle(css: string): void {
    this.colorSheet = this.replace(this.colorSheet, css);
  }

  ended(end: CoverEnd): void {
    this.controller.ended(this, end);
  }

  /** Adds a style sheet to the document, and removes the one that it replaces once it is in. */
  private replace(old: Promise<string> | undefined, css: string): Promise<string> | undefined {
    const contents = this.view.webContents;
    if (contents.isDestroyed()) return old;
    const added = contents.insertCSS(css);
    void Promise.all([old, added])
      .then(([key]) =>
        key === undefined || contents.isDestroyed() ? undefined : contents.removeInsertedCSS(key),
      )
      .catch(() => undefined);
    return added;
  }
}

/** An address without its fragment. */
function withoutHash(address: string): string {
  const hash = address.indexOf('#');
  return hash === -1 ? address : address.slice(0, hash);
}

/** The name of an error, for the log, which never holds the text of an article or an address. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
