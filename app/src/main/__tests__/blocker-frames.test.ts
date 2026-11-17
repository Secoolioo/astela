import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
  Session,
  WebContents,
  WebFrameMain,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { ContentBlocker } from '../../platform/blocker/content-blocker.ts';
import { blockerFrames } from '../blocker-frames.ts';

const web = {} as Session;
const page = { session: web } as WebContents;
const reader = { session: web } as WebContents;
const frame = {
  url: 'https://news.example/story',
  origin: 'https://news.example',
  parent: null,
  top: { url: 'https://news.example/story', origin: 'https://news.example' },
} as unknown as WebFrameMain;

/** The request of a frame preload as it starts, whose answer is its return value. */
function start(sender: WebContents): IpcMainEvent & { returnValue: unknown } {
  return { sender, senderFrame: frame, returnValue: undefined } as unknown as IpcMainEvent & {
    returnValue: unknown;
  };
}

/** The report of a frame's elements. */
function report(sender: WebContents): IpcMainInvokeEvent {
  return { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
}

describe('blockerFrames', () => {
  it('gives the frames of web pages their rules, and those of reader views none', async () => {
    const frameRules = vi.fn(() => ({
      styles: '.ad { display: none }',
      scripts: ['mark()'],
      extended: [],
      elements: true,
    }));
    const elementRules = vi.fn(() => '.promo { display: none }');
    const blocker = {
      loading: () => undefined,
      frameRules,
      elementRules,
    } as unknown as ContentBlocker;
    const frames = blockerFrames(
      blocker,
      (session) => session === web,
      () => Promise.resolve(false),
      (contents) => contents === reader,
    );
    const onPage = start(page);
    frames.frame(onPage);
    await vi.waitFor(() =>
      expect(onPage.returnValue).toEqual({
        styles: '.ad { display: none }',
        scripts: ['mark()'],
        extended: [],
        elements: true,
        blockCookies: false,
      }),
    );
    // A reader view gets its answer at once: no hiding rule, no scriptlet and no report.
    const onReader = start(reader);
    frames.frame(onReader);
    expect(onReader.returnValue).toEqual({
      styles: '',
      scripts: [],
      extended: [],
      elements: false,
    });
    const elements = { classes: ['promo'], ids: [], hrefs: [] };
    expect(await frames.elements(report(page), elements)).toBe('.promo { display: none }');
    expect(await frames.elements(report(reader), elements)).toBe('');
    expect(frameRules).toHaveBeenCalledTimes(1);
    expect(elementRules).toHaveBeenCalledTimes(1);
  });
});
