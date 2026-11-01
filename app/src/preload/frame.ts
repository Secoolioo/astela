import { ipcRenderer, webFrame } from 'electron';

/**
 * Runs in every frame of web pages, top frames and iframes alike, and applies the content
 * blocker's rules for the frame's address: element hiding rules as a style sheet, and
 * scriptlets in the page's own world before the page's scripts run. Rules that depend on
 * the page's elements follow once the document exists and whenever new elements appear.
 * The script exposes nothing to the page.
 */

/** Rules that apply when a frame starts. */
interface FrameRules {
  readonly styles: string;
  readonly scripts: readonly string[];
  /** Whether rules for the page's elements may apply, so the frame should report them. */
  readonly elements: boolean;
}

const isFrameRules = (value: unknown): value is FrameRules =>
  typeof value === 'object' &&
  value !== null &&
  'styles' in value &&
  typeof value.styles === 'string' &&
  'scripts' in value &&
  Array.isArray(value.scripts) &&
  'elements' in value &&
  typeof value.elements === 'boolean';

const rules: unknown = ipcRenderer.sendSync('blocker.frame');
if (isFrameRules(rules)) {
  if (rules.styles !== '') {
    void webFrame.insertCSS(rules.styles);
  }
  for (const script of rules.scripts) {
    if (typeof script === 'string') void webFrame.executeJavaScript(script);
  }
  if (rules.elements) {
    reportElements();
  }
}

/** Reports the classes, ids and link targets of the page as they appear, at most once each. */
function reportElements(): void {
  const seen = new Set<string>();
  const pending = { classes: new Set<string>(), ids: new Set<string>(), hrefs: new Set<string>() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const add = (set: Set<string>, key: string, value: string): void => {
    if (!seen.has(key) && seen.size < 20_000 && value.length <= 512) {
      seen.add(key);
      set.add(value);
    }
  };
  const note = (element: Element): void => {
    for (const name of element.classList) add(pending.classes, `.${name}`, name);
    if (element.id !== '') add(pending.ids, `#${element.id}`, element.id);
    if (element instanceof HTMLAnchorElement && element.href !== '') {
      add(pending.hrefs, `@${element.href}`, element.href);
    }
  };
  const send = (): void => {
    timer = undefined;
    const report = {
      classes: [...pending.classes].slice(0, 1000),
      ids: [...pending.ids].slice(0, 1000),
      hrefs: [...pending.hrefs].slice(0, 1000),
    };
    pending.classes.clear();
    pending.ids.clear();
    pending.hrefs.clear();
    if (report.classes.length + report.ids.length + report.hrefs.length > 0) {
      void ipcRenderer.invoke('blocker.elements', report).then((styles: unknown) => {
        if (typeof styles === 'string' && styles !== '') void webFrame.insertCSS(styles);
      });
    }
  };
  const collect = (root: Element | Document): void => {
    if (root instanceof Element) note(root);
    for (const element of root.querySelectorAll('[class],[id],a[href]')) note(element);
    timer ??= setTimeout(send, 50);
  };
  const start = (): void => {
    collect(document);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) collect(node);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
