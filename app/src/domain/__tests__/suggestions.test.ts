import { describe, expect, it } from 'vitest';
import { suggestionsFor } from '../navigation/suggestions.ts';

const page = (title: string, url: string): { title: string; url: string } => ({ title, url });

describe('suggestionsFor', () => {
  it('starts with what Enter does, then open tabs, bookmarks and visited pages', () => {
    const items = suggestionsFor('news daily', {
      target: { kind: 'search', url: 'https://search.example/?q=news+daily', query: 'news daily' },
      tabs: [{ id: 't2', ...page('Daily news', 'https://news.example/') }],
      bookmarks: [page('News of the day, daily', 'https://daily.example/news')],
      history: [
        page('Daily news', 'https://news.example/'),
        page('The daily paper', 'https://paper.example/news'),
        page('Weather', 'https://weather.example/'),
      ],
    });
    expect(items.map(({ kind, url }) => [kind, url])).toEqual([
      ['search', 'https://search.example/?q=news+daily'],
      ['tab', 'https://news.example/'],
      ['bookmark', 'https://daily.example/news'],
      ['history', 'https://paper.example/news'],
    ]);
    expect(items[1]?.tabId).toBe('t2');
  });

  it('suggests nothing for blank text and at most eight pages', () => {
    const sources = {
      target: undefined,
      tabs: [],
      bookmarks: [],
      history: Array.from({ length: 20 }, (_, index) =>
        page(`Page ${String(index)}`, `https://site.example/${String(index)}`),
      ),
    };
    expect(suggestionsFor('  ', sources)).toEqual([]);
    expect(suggestionsFor('page', sources)).toHaveLength(8);
  });
});
