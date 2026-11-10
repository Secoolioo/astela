import { describe, expect, it } from 'vitest';
import { withoutRemovedParameters } from '../blocker/parameters.ts';

describe('withoutRemovedParameters', () => {
  it('takes out what the engine took out and keeps every other pair as it was', () => {
    expect(
      withoutRemovedParameters(
        'https://shop.example/s?q=caf%C3%A9%20au%20lait&gclid=1&next=%2Fa%3Fb%3D1',
        'https://shop.example/s?q=caf%25C3%25A9%2520au%2520lait&next=%252Fa%253Fb%253D1',
      ),
    ).toBe('https://shop.example/s?q=caf%C3%A9%20au%20lait&next=%2Fa%3Fb%3D1');
    expect(
      withoutRemovedParameters(
        'https://shop.example/s?q=a+b&fbclid=1#top',
        'https://shop.example/s?q=a%2Bb',
      ),
    ).toBe('https://shop.example/s?q=a+b#top');
  });

  it('drops the question mark when no parameter is left, and keeps repeated names', () => {
    expect(
      withoutRemovedParameters('https://news.example/?utm_source=x', 'https://news.example/'),
    ).toBe('https://news.example/');
    expect(
      withoutRemovedParameters(
        'https://a.example/?id=1&id=2&utm_source=x',
        'https://a.example/?id=1&id=2',
      ),
    ).toBe('https://a.example/?id=1&id=2');
    expect(
      withoutRemovedParameters('https://a.example/?ref=1&ref=2', 'https://a.example/?ref=2'),
    ).toBe('https://a.example/?ref=1');
  });

  it('compares names however they were encoded, also when they cannot be decoded', () => {
    expect(
      withoutRemovedParameters(
        'https://a.example/?a%20b=1&x=%E0%A4%A&c=3',
        'https://a.example/?a+b=1&c=3',
      ),
    ).toBe('https://a.example/?a%20b=1&c=3');
    expect(
      withoutRemovedParameters('https://a.example/?%zz=1&y=2', 'https://a.example/?%zz=1'),
    ).toBe('https://a.example/?%zz=1');
  });

  it('leaves an address without a query alone', () => {
    expect(withoutRemovedParameters('https://a.example/p#x', 'https://a.example/p')).toBe(
      'https://a.example/p#x',
    );
  });
});
