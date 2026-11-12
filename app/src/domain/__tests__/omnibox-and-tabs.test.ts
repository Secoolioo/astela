import { describe, expect, it, vi } from 'vitest';
import { resolveOmniboxInput } from '../navigation/omnibox.ts';
import { TabService, type TabViewPort } from '../tabs/tab-service.ts';

const template = 'https://search.example/?q=%s';

describe('search shortcuts', () => {
  const engines = [{ keyword: 'ex', url: 'https://other.example/find?term=%s' }];

  it('searches with the engine of a keyword, built in or added', () => {
    expect(resolveOmniboxInput('ex astela tabs', template, { engines })?.url).toBe(
      'https://other.example/find?term=astela%20tabs',
    );
    expect(resolveOmniboxInput('@Google astela', template)?.url).toBe(
      'https://www.google.com/search?q=astela',
    );
    // A keyword alone, or inside a search, is a search with the default engine.
    expect(resolveOmniboxInput('ex', template, { engines })?.url).toBe(
      'https://search.example/?q=ex',
    );
    expect(resolveOmniboxInput('see ex here', template, { engines })?.url).toBe(
      'https://search.example/?q=see%20ex%20here',
    );
  });

  it('searches the site of a !bang at the start or the end, when !bangs are on', () => {
    const wikipedia = 'https://en.wikipedia.org/wiki/Special:Search?search=astela';
    expect(resolveOmniboxInput('!w astela', template, { bangs: true })?.url).toBe(wikipedia);
    expect(resolveOmniboxInput('astela !W', template, { bangs: true })?.url).toBe(wikipedia);
    expect(resolveOmniboxInput('!w astela', template)?.url).toBe(
      'https://search.example/?q=!w%20astela',
    );
    expect(resolveOmniboxInput('!nothing astela', template, { bangs: true })?.url).toBe(
      'https://search.example/?q=!nothing%20astela',
    );
    expect(resolveOmniboxInput('a !w b', template, { bangs: true })?.url).toBe(
      'https://search.example/?q=a%20!w%20b',
    );
  });
});

describe('resolveOmniboxInput', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  sub.example.co.uk/path?q=1 ', 'https://sub.example.co.uk/path?q=1'],
    ['localhost:3000', 'http://localhost:3000'],
    ['192.168.1.10/admin', 'http://192.168.1.10/admin'],
    ['[::1]:8080', 'http://[::1]:8080'],
    ['https://example.com/a b'.replace(' ', '%20'), 'https://example.com/a%20b'],
    ['about:blank', 'about:blank'],
    ['app://settings/#tabs.position', 'app://settings/#tabs.position'],
  ])('opens %s as a URL', (input, url) => {
    expect(resolveOmniboxInput(input, template)).toEqual({ kind: 'url', url });
  });

  it.each([
    ['how fast is astela', 'how%20fast%20is%20astela'],
    ['javascript:alert(1)', 'javascript%3Aalert(1)'],
    ['data:text/html,hi', 'data%3Atext%2Fhtml%2Chi'],
    ['singleword', 'singleword'],
    ['https://exa mple.com', 'https%3A%2F%2Fexa%20mple.com'],
    ['3.14', '3.14'],
    ['C++ templates', 'C%2B%2B%20templates'],
  ])('searches for %s', (input, encoded) => {
    expect(resolveOmniboxInput(input, template)).toEqual({
      kind: 'search',
      query: input.trim(),
      url: `https://search.example/?q=${encoded}`,
    });
  });

  it('ignores blank input', () => {
    expect(resolveOmniboxInput('   ', template)).toBeUndefined();
  });

  it('treats host:port as a host, not as a scheme', () => {
    expect(resolveOmniboxInput('example.com:8443/x', template)).toEqual({
      kind: 'url',
      url: 'https://example.com:8443/x',
    });
  });
});

class FakeViews implements TabViewPort {
  readonly log: string[] = [];
  create(id: string, url: string): void {
    this.log.push(`create ${id} ${url}`);
  }
  show(id: string): void {
    this.log.push(`show ${id}`);
  }
  destroy(id: string): void {
    this.log.push(`destroy ${id}`);
  }
  load(id: string, url: string): void {
    this.log.push(`load ${id} ${url}`);
  }
  run(id: string, action: string): void {
    this.log.push(`${action} ${id}`);
  }
}

describe('TabService', () => {
  it('opens tabs after the active one and activates them', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/', { activate: false });
    tabs.activate(a);
    const c = tabs.open();
    expect(tabs.all.map((t) => t.id)).toEqual([a, c, b]);
    expect(tabs.active?.id).toBe(c);
    expect(views.log).toEqual([
      `create ${a} https://a.example/`,
      `show ${a}`,
      `create ${b} https://b.example/`,
      `create ${c} about:blank`,
      `show ${c}`,
    ]);
  });

  it('lines up background tabs in the order they open until another tab becomes active', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const ids = (): string[] => tabs.all.map((t) => t.id);
    const page = tabs.open('https://page.example/');
    const other = tabs.open('https://other.example/');
    tabs.activate(page);
    const a = tabs.open('https://a.example/', { activate: false });
    const b = tabs.open('https://b.example/', { activate: false });
    expect(ids()).toEqual([page, a, b, other]);
    tabs.close(a);
    const c = tabs.open('https://c.example/', { activate: false });
    expect(ids()).toEqual([page, b, c, other]);
    expect(tabs.active?.id).toBe(page);
    const d = tabs.open('https://d.example/');
    expect(ids()).toEqual([page, d, b, c, other]);
    tabs.activate(page);
    const e = tabs.open('https://e.example/', { activate: false });
    expect(ids()).toEqual([page, e, d, b, c, other]);
  });

  it('activates the right neighbour on close, then the left one, and keeps one tab', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    const c = tabs.open('https://c.example/');
    tabs.activate(b);
    tabs.close(b);
    expect(tabs.active?.id).toBe(c);
    tabs.close(c);
    expect(tabs.active?.id).toBe(a);
    tabs.close(a);
    expect(tabs.all).toHaveLength(1);
    expect(tabs.active?.url).toBe('about:blank');
  });

  it('lets a popup close with its last tab instead of opening a new one', () => {
    let closed = 0;
    const tabs = new TabService(new FakeViews(), 'about:blank', () => (closed += 1));
    const a = tabs.open('https://a.example/');
    tabs.close(a);
    expect(tabs.all).toHaveLength(0);
    expect(closed).toBe(1);
  });

  it('closes inactive tabs without changing the active one', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    tabs.close(a);
    expect(tabs.active?.id).toBe(b);
  });

  it('reopens closed tabs in reverse order and keeps at most 25', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    expect(tabs.canReopen).toBe(false);
    for (let i = 0; i < 30; i += 1) {
      tabs.close(tabs.open(`https://${i}.example/`));
    }
    const reopened: string[] = [];
    for (let id = tabs.reopenClosed(); id !== undefined; id = tabs.reopenClosed()) {
      reopened.push(tabs.all.find((t) => t.id === id)?.url ?? '');
    }
    expect(reopened).toHaveLength(25);
    expect(reopened[0]).toBe('https://29.example/');
    expect(reopened.at(-1)).toBe('https://5.example/');
    expect(tabs.canReopen).toBe(false);
    tabs.close(tabs.open('https://again.example/'));
    expect(tabs.canReopen).toBe(true);
    tabs.reopenClosed();
    expect(tabs.canReopen).toBe(false);
  });

  it('forwards navigation and actions and applies view updates', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const id = tabs.open();
    const listener = vi.fn();
    tabs.onDidChange(listener);
    tabs.navigate(id, 'https://example.com/');
    tabs.run(id, 'reload');
    tabs.update(id, { title: 'Example', loading: false });
    tabs.update(id, { title: 'Example' });
    tabs.update('t999', { title: 'x' });
    expect(views.log.slice(-2)).toEqual([`load ${id} https://example.com/`, `reload ${id}`]);
    expect(tabs.active).toMatchObject({ title: 'Example', loading: false });
    expect(listener).toHaveBeenCalledOnce();
    expect(() => tabs.activate('t999')).toThrow('Unknown tab t999');
  });

  it('moves a tab to another place and keeps the active tab', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    const c = tabs.open('https://c.example/');
    let changes = 0;
    tabs.onDidChange(() => (changes += 1));
    tabs.move(a, 2);
    expect(tabs.all.map((tab) => tab.id)).toEqual([b, c, a]);
    tabs.move(c, 0);
    expect(tabs.all.map((tab) => tab.id)).toEqual([c, b, a]);
    // An index past the end puts the tab last.
    tabs.move(c, 99);
    expect(tabs.all.map((tab) => tab.id)).toEqual([b, a, c]);
    expect(tabs.active?.id).toBe(c);
    expect(changes).toBe(3);
  });

  it('keeps pinned tabs first and opens and moves the other tabs after them', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    const c = tabs.open('https://c.example/');
    const order = (): string[] => tabs.all.map((tab) => tab.id);
    tabs.pin(c, true);
    tabs.pin(b, true);
    expect(order()).toEqual([c, b, a]);
    expect(tabs.all.map((tab) => tab.pinned)).toEqual([true, true, false]);
    // A tab opened from a pinned tab, or moved to the front, stays after the pinned tabs.
    tabs.activate(c);
    const d = tabs.open('https://d.example/');
    expect(order()).toEqual([c, b, d, a]);
    tabs.move(a, 0);
    expect(order()).toEqual([c, b, a, d]);
    // A pinned tab moves among the pinned tabs only.
    tabs.move(c, 3);
    expect(order()).toEqual([b, c, a, d]);
    tabs.pin(b, false);
    expect(order()).toEqual([c, b, a, d]);
    expect(tabs.all[1]?.pinned).toBe(false);
    // A tab can open right after another one, and pinned when restored.
    const e = tabs.open('https://e.example/', { after: a });
    expect(order()).toEqual([c, b, a, e, d]);
    const f = tabs.open('https://f.example/', { pinned: true, activate: false });
    expect(order()).toEqual([c, f, b, a, e, d]);
  });

  it('lines up background tabs of a pinned tab after the pinned tabs, in the order they open', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const mail = tabs.open('https://mail.example/', { pinned: true });
    const calendar = tabs.open('https://calendar.example/', { pinned: true });
    const other = tabs.open('https://other.example/');
    const order = (): string[] => tabs.all.map((tab) => tab.id);
    expect(order()).toEqual([mail, calendar, other]);
    // A pinned tab that is not the last one opens links in the background.
    tabs.activate(mail);
    const first = tabs.open('https://1.example/', { activate: false });
    const second = tabs.open('https://2.example/', { activate: false });
    const third = tabs.open('https://3.example/', { activate: false });
    expect(order()).toEqual([mail, calendar, first, second, third, other]);
    // The last pinned tab does the same.
    tabs.activate(calendar);
    const fourth = tabs.open('https://4.example/', { activate: false });
    const fifth = tabs.open('https://5.example/', { activate: false });
    expect(order()).toEqual([mail, calendar, fourth, fifth, first, second, third, other]);
    // A tab opened in the foreground from a pinned tab comes right after the pinned tabs.
    tabs.activate(mail);
    const front = tabs.open('https://front.example/');
    expect(order()[2]).toBe(front);
    expect(tabs.active?.id).toBe(front);
  });

  it('tells a session only about the changes that it keeps', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const id = tabs.open('https://a.example/');
    let kept = 0;
    let all = 0;
    tabs.onDidChangeKept(() => (kept += 1));
    tabs.onDidChange(() => (all += 1));
    tabs.update(id, { blocked: 3 });
    tabs.update(id, { loading: false });
    tabs.update(id, { audible: true });
    expect([kept, all]).toEqual([0, 3]);
    tabs.update(id, { title: 'A' });
    tabs.update(id, { url: 'https://a.example/next' });
    tabs.open('https://b.example/');
    expect(kept).toBe(3);
  });

  it('destroys every view on dispose', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open();
    const b = tabs.open();
    tabs.dispose();
    expect(views.log.filter((l) => l.startsWith('destroy'))).toEqual([
      `destroy ${a}`,
      `destroy ${b}`,
    ]);
  });
});
