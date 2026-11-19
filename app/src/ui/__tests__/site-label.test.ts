import { describe, expect, it } from 'vitest';
import { siteLabel } from '../shell/site-label.ts';

describe('siteLabel', () => {
  it('names the host of a web page with its port', () => {
    expect(siteLabel('https://accounts.example.com/sign-in?next=1')).toBe('accounts.example.com');
    expect(siteLabel('http://127.0.0.1:8080/rows.html')).toBe('127.0.0.1:8080');
    expect(siteLabel('HTTPS://Example.COM/')).toBe('example.com');
  });

  it('names the site that made a blob or filesystem address', () => {
    expect(siteLabel('blob:https://evil.example/6f1c2d3e-0000-4000-8000-000000000000')).toBe(
      'evil.example',
    );
    expect(siteLabel('filesystem:https://evil.example:8443/temporary/page.html')).toBe(
      'evil.example:8443',
    );
    // A blob of an opaque origin names its scheme.
    expect(siteLabel('blob:null/6f1c2d3e-0000-4000-8000-000000000000')).toBe('blob:');
  });

  it('names an empty page and the scheme of every other address', () => {
    expect(siteLabel('about:blank')).toBe('about:blank');
    expect(siteLabel('about:blank#top')).toBe('about:blank');
    expect(siteLabel('file:///home/user/page.html')).toBe('file:');
    expect(siteLabel('data:text/html,<title>Sign in</title>')).toBe('data:');
  });

  it('names nothing for the browser’s own pages, whose titles name them', () => {
    expect(siteLabel('app://settings/#layout')).toBe('');
    expect(siteLabel('app://newtab/')).toBe('');
    expect(siteLabel('')).toBe('');
  });
});
