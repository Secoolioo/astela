import { describe, expect, it } from 'vitest';
import { engineForSearchUrl, searchEngines } from '../../shared/search-engines.ts';
import { ViewHistory, type ViewSnapshot } from '../tabs/view-history.ts';

const view = (...urls: string[]): ViewSnapshot => ({
  entries: urls.map((url) => ({ url, title: url })),
  index: urls.length - 1,
});

describe('ViewHistory', () => {
  it('steps back and forward across views', () => {
    const history = new ViewHistory();
    expect([history.canGoBack, history.canGoForward]).toEqual([false, false]);
    expect(history.goBack(view('app://newtab/'))).toBeUndefined();
    expect(history.canGoForward).toBe(false);
    history.leave(view('app://newtab/'));
    expect(history.canGoBack).toBe(true);
    const web = view('https://a.example/', 'https://b.example/');
    expect(history.goBack(web)).toEqual(view('app://newtab/'));
    expect([history.canGoBack, history.canGoForward]).toEqual([false, true]);
    expect(history.goForward(view('app://newtab/'))).toEqual(web);
    expect([history.canGoBack, history.canGoForward]).toEqual([true, false]);
    expect(history.goForward(web)).toBeUndefined();
  });

  it('drops later views when the tab leaves for a new page, and keeps at most 50', () => {
    const history = new ViewHistory();
    history.leave(view('app://newtab/'));
    history.goBack(view('https://a.example/'));
    history.leave(view('app://newtab/'));
    expect(history.canGoForward).toBe(false);
    for (let i = 0; i < 60; i += 1) history.leave(view(`https://${i}.example/`));
    let steps = 0;
    while (history.goBack(view('https://now.example/')) !== undefined) steps += 1;
    expect(steps).toBe(50);
  });
});

describe('search engines', () => {
  it('offers plain https search URLs with one query placeholder', () => {
    expect(searchEngines.map((engine) => engine.id)).toEqual([
      'duckduckgo',
      'google',
      'bing',
      'startpage',
      'ecosia',
      'brave',
      'qwant',
    ]);
    for (const engine of searchEngines) {
      expect(engine.searchUrl).toMatch(/^https:\/\/[^\s%]+=%s$/);
    }
  });

  it('finds the engine of a search URL', () => {
    expect(engineForSearchUrl('https://duckduckgo.com/?q=%s')?.name).toBe('DuckDuckGo');
    expect(engineForSearchUrl('https://search.example/?q=%s')).toBeUndefined();
  });
});
