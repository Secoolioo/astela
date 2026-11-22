import {
  handlePseudoDirective,
  querySelectorAll,
  type AST,
} from '@ghostery/adblocker-extended-selectors';
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { noAppRegionCss } from '../shared/app-region.ts';
import { scriptletWorld } from '../shared/isolated-worlds.ts';
import { guardCredentials, watchKeySystems, type SecurityKeyReport } from './page-world.ts';
import { startOver, watchTabOut } from './tab-out.ts';

/**
 * Runs in every frame of web pages, top frames and iframes alike. It first keeps the frame
 * from marking parts of the window that move it, whether the content blocker is on or not,
 * and then applies the content blocker's rules for the frame's address: element hiding rules
 * as a style sheet, and scriptlets in the page's own world before the page's scripts run.
 * Rules that depend on the page's elements follow once the document exists and whenever new
 * elements appear. On Linux and macOS, where Electron shows nothing while a site waits for a
 * security key, requests of security keys and passkeys tell the browser that they start and end,
 * and end when the browser cancels them (`page-world.ts`); Windows shows its own dialog. A
 * request for protected playback that fails tells the browser once, which says why the site
 * cannot play its video or music. In the top frame, Tab past the end of the page, or Shift+Tab
 * past its start, tells the browser, which moves the focus on to the toolbar (`tab-out.ts`). The
 * script exposes nothing to the page.
 */

/** A procedural rule: the elements of its selector are hidden or changed by its directive. */
interface ExtendedRule {
  readonly ast: AST;
  readonly attribute?: string;
  readonly directive?: AST;
}

/** Rules that apply when a frame starts. */
interface FrameRules {
  readonly styles: string;
  readonly scripts: readonly string[];
  readonly extended: readonly ExtendedRule[];
  /** Whether rules for the page's elements may apply, so the frame should report them. */
  readonly elements: boolean;
  /** Whether the frame belongs to another site than its page and finds no cookies. */
  readonly blockCookies?: boolean;
}

const isFrameRules = (value: unknown): value is FrameRules =>
  typeof value === 'object' &&
  value !== null &&
  'styles' in value &&
  typeof value.styles === 'string' &&
  'scripts' in value &&
  Array.isArray(value.scripts) &&
  'extended' in value &&
  Array.isArray(value.extended) &&
  'elements' in value &&
  typeof value.elements === 'boolean';

/**
 * Marks a scriptlet that runs in an isolated world of its own, `scriptletWorld`, rather than in
 * the page's; tools/blocker/build.ts adds it. The preload itself runs in Electron's world 999.
 */
const isolatedMark = '/*astela:isolated-world*/';

/**
 * Wraps a scriptlet in a scope of its own: scriptlets bring their helpers as declarations,
 * and two scriptlets with the same helper would collide in the page's global scope. A
 * failing scriptlet leaves a warning in the console instead of an error.
 * @param script - The scriptlet with its helpers.
 */
function scoped(script: string): string {
  return `(() => { try {\n${script}\n} catch (error) { console.warn('[astela scriptlet]', error); } })();`;
}

/**
 * Hides cookies from the scripts of an embedded frame of another site, before they run: the
 * browser already sends its requests without cookies. Service workers and shared workers
 * belong to no page, so the browser could not keep their requests apart from those of the
 * site itself; such a frame starts none, and the ones it started before are removed.
 */
const cookieGuard = `(() => {
  const lock = (target, name, descriptor) => Object.defineProperty(target, name, { configurable: false, ...descriptor });
  lock(Document.prototype, 'cookie', { get: () => '', set: () => {} });
  if ('cookieStore' in globalThis) lock(globalThis, 'cookieStore', { get: () => undefined });
  if ('ServiceWorkerContainer' in globalThis) {
    lock(ServiceWorkerContainer.prototype, 'register', {
      value: () => Promise.reject(new DOMException('Embedded frames of other sites cannot start service workers.', 'SecurityError')),
    });
    navigator.serviceWorker?.getRegistrations().then((all) => { for (const registration of all) void registration.unregister(); }, () => {});
  }
  if ('SharedWorker' in globalThis) lock(globalThis, 'SharedWorker', { value: undefined });
})();`;

// Before the page has styles or scripts: a page that marks a region with app-region would
// move the window from the tabs, the address bar or a question above it.
webFrame.insertCSS(noAppRegionCss, { cssOrigin: 'user' });

const rules: unknown = ipcRenderer.sendSync('blocker.frame');
if (isFrameRules(rules)) {
  if (rules.blockCookies === true) void webFrame.executeJavaScript(cookieGuard);
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
  if (rules.extended.length > 0) {
    applyExtended(rules.extended);
  }
  if (rules.elements) {
    reportElements();
  }
}

// The keys that leave the page go on in the toolbar, and those from the toolbar start the page
// over at its start or its end.
if (window.top === window) {
  watchTabOut(window, document, (reverse) => ipcRenderer.send('page.tabOut', reverse));
  ipcRenderer.on('page.tabIn', (_event, reverse: unknown) => startOver(document, reverse === true));
}

// The wrappers of the page's own world, before the page's scripts. A frame whose world runs no
// scripts, such as a sandboxed one, gets none and keeps the rules above.
try {
  contextBridge.executeInMainWorld({
    func: watchKeySystems,
    args: [(keySystem: string) => ipcRenderer.send('media.protected', keySystem)],
  });
  if (process.platform !== 'win32') {
    const cancel: unknown = contextBridge.executeInMainWorld({
      func: guardCredentials,
      args: [
        (event: SecurityKeyReport, id: number) => ipcRenderer.send('webauthn.request', event, id),
      ],
    });
    ipcRenderer.on('webauthn.cancel', (_event, id: unknown) => {
      if (typeof cancel === 'function' && typeof id === 'number') cancel(id);
    });
  }
} catch {
  // Nothing to wrap where the page has no scripts.
}

/**
 * Applies procedural rules, such as `:has-text()`, once the document exists and again when
 * it changes, at most every 100 ms: elements of a hiding rule get the attribute that the
 * style sheet hides, and other rules run their directive, such as removing the element.
 * Each rule handles an element once, so its own changes do not start it again.
 * @param extended - The procedural rules of the frame's address.
 */
function applyExtended(extended: readonly ExtendedRule[]): void {
  const handled = extended.map(() => new WeakSet<Element>());
  const run = (): void => {
    extended.forEach((rule, index) => {
      const seen = handled[index];
      try {
        for (const element of querySelectorAll(document.documentElement, rule.ast)) {
          if (seen === undefined || seen.has(element)) continue;
          seen.add(element);
          if (rule.directive !== undefined) handlePseudoDirective(element, rule.directive);
          else if (rule.attribute !== undefined) element.setAttribute(rule.attribute, '');
        }
      } catch {
        // A rule that the evaluator cannot handle changes nothing.
      }
    });
  };
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      run();
    }, 100);
  };
  const start = (): void => {
    run();
    new MutationObserver(schedule).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'id'],
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
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
