import type { Session } from 'electron';
import { describe, expect, it } from 'vitest';
import { resourceUrl, serveResources } from '../blocker/resource-protocol.ts';

describe('serveResources', () => {
  it('serves a stand-in only under the secret path of this run', () => {
    let handler: ((request: Request) => Response) | undefined;
    const session = {
      protocol: {
        handle: (_scheme: string, handle: (request: Request) => Response) => {
          handler = handle;
        },
      },
    } as unknown as Session;
    serveResources(session, (name) =>
      name === 'noop.js'
        ? { body: '(function(){})();', contentType: 'application/javascript' }
        : undefined,
    );
    const status = (url: string): number | undefined => handler?.(new Request(url)).status;
    expect(resourceUrl('noop.js')).toMatch(
      /^astela-resource:\/\/resource\/[0-9a-f-]{36}\/noop\.js$/,
    );
    expect(status(resourceUrl('noop.js'))).toBe(200);
    expect(status('astela-resource://resource/noop.js')).toBe(404);
    expect(status(resourceUrl('missing.js'))).toBe(404);
  });
});
