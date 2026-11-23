import type { Session } from 'electron';
import { describe, expect, it } from 'vitest';
import { resourceUrl } from '../blocker/resource-answers.ts';
import { serveResources, type ReplacementResource } from '../blocker/resource-protocol.ts';

/** The handler that `serveResources` registers on a web session, with the resources it finds. */
function served(
  resources: Record<string, ReplacementResource>,
): (url: string) => Promise<Response | undefined> {
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  const session = {
    protocol: {
      handle: (_scheme: string, handle: (request: Request) => Response | Promise<Response>) => {
        handler = handle;
      },
    },
  } as unknown as Session;
  serveResources(session, (name) => resources[name]);
  return async (url) => handler?.(new Request(url));
}

describe('serveResources', () => {
  it('serves a stand-in only under the secret path of this run', async () => {
    const answer = served({
      'noop.js': { body: '(function(){})();', contentType: 'application/javascript' },
    });
    const status = async (url: string): Promise<number | undefined> => (await answer(url))?.status;
    expect(resourceUrl('noop.js')).toMatch(
      /^astela-resource:\/\/resource\/[0-9a-f-]{36}\/noop\.js$/,
    );
    expect(await status(resourceUrl('noop.js'))).toBe(200);
    expect(await status('astela-resource://resource/noop.js')).toBe(404);
    expect(await status(resourceUrl('missing.js'))).toBe(404);
  });

  it('answers with the type and the body of the resource, decoding Base64', async () => {
    const answer = served({
      'noop.js': { body: '(function(){})();', contentType: 'application/javascript' },
      '1x1.gif': { body: 'R0lGODlhAQABAAAAACw=', contentType: 'image/gif;base64' },
    });
    const script = await answer(resourceUrl('noop.js'));
    expect(script?.headers.get('content-type')).toBe('application/javascript');
    expect(script?.headers.get('access-control-allow-origin')).toBe('*');
    expect(script?.headers.get('cache-control')).toBe('no-store');
    expect(await script?.text()).toBe('(function(){})();');
    const image = await answer(resourceUrl('1x1.gif'));
    expect(image?.headers.get('content-type')).toBe('image/gif');
    expect(Buffer.from(await (image as Response).arrayBuffer()).toString('base64')).toBe(
      'R0lGODlhAQABAAAAACw=',
    );
  });
});
