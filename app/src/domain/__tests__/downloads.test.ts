import { describe, expect, it } from 'vitest';
import { freeName, progressOf } from '../downloads/downloads.ts';

/** A folder with some names taken. */
const folder =
  (...names: string[]) =>
  (name: string): boolean =>
    names.includes(name);

describe('freeName', () => {
  it('keeps a free name and numbers a taken one before its extension', () => {
    expect(freeName('report.pdf', folder())).toBe('report.pdf');
    expect(freeName('report.pdf', folder('report.pdf'))).toBe('report (1).pdf');
    expect(freeName('report.pdf', folder('report.pdf', 'report (1).pdf'))).toBe('report (2).pdf');
  });

  it('keeps double extensions of archives and names without one', () => {
    expect(freeName('logs.tar.gz', folder('logs.tar.gz'))).toBe('logs (1).tar.gz');
    expect(freeName('README', folder('README'))).toBe('README (1)');
    expect(freeName('.env', folder('.env'))).toBe('.env (1)');
    expect(freeName('my file.v2.zip', folder('my file.v2.zip'))).toBe('my file.v2 (1).zip');
  });
});

describe('progressOf', () => {
  it('tells how much is done while the size is known', () => {
    expect(progressOf({ received: 50, total: 200 })).toBe(0.25);
    expect(progressOf({ received: 300, total: 200 })).toBe(1);
    expect(progressOf({ received: 50, total: 0 })).toBeUndefined();
  });
});
