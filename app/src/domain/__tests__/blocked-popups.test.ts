import { describe, expect, it } from 'vitest';
import { BlockedPopups } from '../navigation/blocked-popups.ts';

describe('BlockedPopups', () => {
  it('counts every pop-up and lists the latest ones', () => {
    const popups = new BlockedPopups(2, 100);
    popups.add('https://a.example/');
    popups.add('https://b.example/');
    popups.add('https://c.example/');
    expect(popups.count).toBe(3);
    expect(popups.urls).toEqual(['https://b.example/', 'https://c.example/']);
  });

  it('counts an address that is too long to list, and keeps none of it', () => {
    const popups = new BlockedPopups(20, 8192);
    const long = `https://pay.example/start?ctx=${'x'.repeat(9000)}`;
    popups.add(long);
    expect(popups.count).toBe(1);
    expect(popups.urls).toEqual([]);
    expect(popups.open(long)).toBe(false);
    expect(popups.count).toBe(1);
    // The longest address that the list takes.
    const longest = `https://a.example/?${'y'.repeat(8192 - 'https://a.example/?'.length)}`;
    popups.add(longest);
    expect(popups.urls).toEqual([longest]);
  });

  it('takes what people open out of the list, and ends the count with the list', () => {
    const popups = new BlockedPopups(1, 100);
    popups.add('https://a.example/');
    popups.add('https://b.example/');
    expect(popups.open('https://a.example/')).toBe(false);
    expect(popups.open('https://b.example/')).toBe(true);
    // Nothing is left to open: the pop-up that left the list counts no more either.
    expect(popups.count).toBe(0);
    expect(popups.urls).toEqual([]);
  });

  it('counts one less for each pop-up that opens while others are left', () => {
    const popups = new BlockedPopups(20, 100);
    popups.add('https://a.example/');
    popups.add('https://a.example/');
    expect(popups.open('https://a.example/')).toBe(true);
    expect(popups.count).toBe(1);
    expect(popups.urls).toEqual(['https://a.example/']);
  });

  it('forgets everything when the page goes to another document', () => {
    const popups = new BlockedPopups(20, 100);
    expect(popups.clear()).toBe(false);
    popups.add('https://a.example/');
    expect(popups.clear()).toBe(true);
    expect(popups.count).toBe(0);
    expect(popups.urls).toEqual([]);
  });
});
