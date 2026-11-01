import { describe, expect, it } from 'vitest';
import { linksFromArguments } from '../navigation/links.ts';

describe('linksFromArguments', () => {
  it('keeps web addresses and skips switches, files and other schemes', () => {
    expect(
      linksFromArguments([
        '--no-sandbox',
        'https://example.com/a b',
        'https://example.com/',
        '/home/user/page.html',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'HTTP://EXAMPLE.ORG/',
      ]),
    ).toEqual(['https://example.com/', 'HTTP://EXAMPLE.ORG/']);
  });

  it('reads every argument after -- as an address, but no other scheme', () => {
    expect(
      linksFromArguments(['--', '--https://x.example/', 'https://y.example/', 'app://settings']),
    ).toEqual(['https://y.example/']);
  });

  it('opens at most 50 links and no overlong address', () => {
    const many = Array.from({ length: 60 }, (_, i) => `https://e${i}.example/`);
    expect(linksFromArguments(many)).toHaveLength(50);
    expect(linksFromArguments([`https://e.example/${'a'.repeat(9000)}`])).toEqual([]);
  });
});
