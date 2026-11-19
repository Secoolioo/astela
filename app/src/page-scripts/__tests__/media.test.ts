import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaRequest } from '../../domain/media/media.ts';
import { run } from '../media.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the media script', () => {
  it('acts only in the document that the browser chose, not in the one that its frame shows after a navigation', async () => {
    vi.stubGlobal('location', { href: 'https://example.com/next.html' });
    const page = 'https://example.com/video.html';
    const until = Date.now() + 3000;
    const requests: MediaRequest[] = [
      { kind: 'enter', index: 0, until, page },
      { kind: 'enterAt', point: { x: 10, y: 10 }, src: '', until, page },
      { kind: 'exit', page },
    ];
    for (const request of requests) {
      expect(await run(request)).toEqual({ done: false, error: 'OtherPage' });
    }
  });
});
