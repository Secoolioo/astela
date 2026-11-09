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

/** Marks a scriptlet that runs in an isolated world; tools/blocker/build.ts adds it. */
const isolatedMark = '/*astela:isolated-world*/';
/** The isolated world of such scriptlets; the preload itself runs in Electron's world 999. */
const scriptletWorld = 1001;

/**
 * Wraps a scriptlet in a scope of its own: scriptlets bring their helpers as declarations,
 * and two scriptlets with the same helper would collide in the page's global scope. A
 * failing scriptlet leaves a warning in the console instead of an error.
 * @param script - The scriptlet with its helpers.
 */
function scoped(script: string): string {
  return `(() => { try {\n${script}\n} catch (error) { console.warn('[astela scriptlet]', error); } })();`;
}

const rules: unknown = ipcRenderer.sendSync('blocker.frame');
if (isFrameRules(rules)) {
  // A user style sheet: its !important rules beat the page's own.
  if (rules.styles !== '') webFrame.insertCSS(rules.styles, { cssOrigin: 'user' });
  for (const script of rules.scripts) {
    if (typeof script !== 'string') continue;
    const code = scoped(script);
    if (script.includes(isolatedMark)) {
      void webFrame.executeJavaScriptInIsolatedWorld(scriptletWorld, [{ code }]);
    } else {
      void webFrame.executeJavaScript(code);
    }
  }
  if (rules.elements) {
    reportElements();
  }
}

/** Takes at most 1000 values out of a set; a report holds no more of each kind. */
function take(set: Set<string>): string[] {
  const values = [...set].slice(0, 1000);
  for (const value of values) set.delete(value);
  return values;
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
      classes: take(pending.classes),
      ids: take(pending.ids),
      hrefs: take(pending.hrefs),
    };
    // What did not fit in this report follows in the next one.
    if (pending.classes.size + pending.ids.size + pending.hrefs.size > 0) {
      timer = setTimeout(send, 50);
    }
    if (report.classes.length + report.ids.length + report.hrefs.length > 0) {
      void ipcRenderer.invoke('blocker.elements', report).then((styles: unknown) => {
        if (typeof styles === 'string' && styles !== '') {
          webFrame.insertCSS(styles, { cssOrigin: 'user' });
        }
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
