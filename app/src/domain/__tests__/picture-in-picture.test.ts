import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  bestVideo,
  mediaLimits,
  videoRank,
  type MediaReport,
  type VideoReport,
} from '../media/media.ts';
import {
  chooseVideo,
  MediaOutcomeSchema,
  MediaReportSchema,
  pictureInPictureState,
} from '../media/picture-in-picture.ts';

/** A video that can show in picture in picture, paused and silent, of an area. */
function video(area: number, change: Partial<VideoReport> = {}): VideoReport {
  return { ready: true, playing: false, audible: false, area, ...change };
}

/** The report of a frame with videos. */
function frame(videos: readonly VideoReport[], pip = false): MediaReport {
  return { videos, pip };
}

describe('videoRank and bestVideo', () => {
  it('rank a video that plays with sound over one that plays, over one with a picture', () => {
    expect(videoRank(video(10, { playing: true, audible: true }))).toBe(3);
    expect(videoRank(video(10, { playing: true }))).toBe(2);
    expect(videoRank(video(10))).toBe(1);
    // Sound alone counts only while the video plays.
    expect(videoRank(video(10, { audible: true }))).toBe(1);
    expect(videoRank(video(10, { ready: false, playing: true, audible: true }))).toBe(0);
  });

  it('take the best rank first, then the largest area, then the first of equal videos', () => {
    expect(
      bestVideo([video(900), video(10, { playing: true }), video(20, { playing: true })]),
    ).toBe(2);
    expect(
      bestVideo([video(50, { playing: true }), video(500, { playing: true, audible: true })]),
    ).toBe(1);
    expect(bestVideo([video(30), video(30)])).toBe(0);
    expect(bestVideo([video(1000, { ready: false }), video(1)])).toBe(1);
    expect(bestVideo([video(1000, { ready: false })])).toBeUndefined();
    expect(bestVideo([])).toBeUndefined();
  });
});

describe('chooseVideo', () => {
  it('ends picture in picture in the frame whose video shows in it, before anything else', () => {
    expect(
      chooseVideo([
        frame([video(900, { playing: true, audible: true })]),
        frame([video(10)], true),
      ]),
    ).toEqual({ kind: 'exit', frame: 1 });
  });

  it('shows the video that plays with sound and is largest, then one that plays, then one with a picture', () => {
    const frames = [
      frame([video(5000), video(100, { playing: true })]),
      frame([
        video(50, { playing: true, audible: true }),
        video(400, { playing: true, audible: true }),
      ]),
    ];
    expect(chooseVideo(frames)).toEqual({ kind: 'enter', frame: 1, video: 1 });
    expect(chooseVideo([frame([video(5000), video(100, { playing: true })])])).toEqual({
      kind: 'enter',
      frame: 0,
      video: 1,
    });
    expect(chooseVideo([frame([video(300), video(5000)])])).toEqual({
      kind: 'enter',
      frame: 0,
      video: 1,
    });
  });

  it('lets the main frame win over another frame with an equal video', () => {
    const equal = video(200, { playing: true });
    expect(chooseVideo([frame([equal]), frame([equal])])).toEqual({
      kind: 'enter',
      frame: 0,
      video: 0,
    });
  });

  it('ignores videos that cannot show in picture in picture, and pages without a video', () => {
    expect(chooseVideo([frame([video(900, { ready: false, playing: true })])])).toBeUndefined();
    expect(chooseVideo([frame([]), frame([])])).toBeUndefined();
    expect(chooseVideo([])).toBeUndefined();
  });
});

describe('pictureInPictureState', () => {
  it('is open while a video shows in picture in picture, and available while one plays', () => {
    expect(pictureInPictureState([frame([video(10)]), frame([], true)])).toBe('open');
    expect(pictureInPictureState([frame([video(10, { playing: true })])])).toBe('available');
    expect(pictureInPictureState([frame([video(10)])])).toBe('none');
    // A video that plays but cannot show in picture in picture offers nothing.
    expect(pictureInPictureState([frame([video(10, { ready: false, playing: true })])])).toBe(
      'none',
    );
    expect(pictureInPictureState([])).toBe('none');
  });
});

describe('MediaReportSchema and MediaOutcomeSchema', () => {
  it('accept the reports of the media script', () => {
    const report = frame([video(100, { playing: true, audible: true }), video(0)], true);
    expect(v.parse(MediaReportSchema, report)).toEqual(report);
    expect(v.parse(MediaOutcomeSchema, { done: true })).toEqual({ done: true });
    expect(v.parse(MediaOutcomeSchema, { done: false, error: 'NotAllowedError' })).toEqual({
      done: false,
      error: 'NotAllowedError',
    });
  });

  it('refuse more videos than the limit, negative or endless areas and keys of their own', () => {
    const many = frame(Array.from({ length: mediaLimits.videos + 1 }, () => video(1)));
    expect(v.safeParse(MediaReportSchema, many).success).toBe(false);
    expect(
      v.safeParse(
        MediaReportSchema,
        frame(Array.from({ length: mediaLimits.videos }, () => video(1))),
      ).success,
    ).toBe(true);
    for (const area of [-1, Number.POSITIVE_INFINITY, Number.NaN, mediaLimits.area + 1]) {
      expect(v.safeParse(MediaReportSchema, frame([video(area)])).success).toBe(false);
    }
    expect(v.safeParse(MediaReportSchema, { ...frame([]), extra: 1 }).success).toBe(false);
    // A video tells nothing of itself but what the browser asks, such as no address.
    const withAddress = { ...video(1), src: 'https://example.com/' };
    expect(v.safeParse(MediaReportSchema, { videos: [withAddress], pip: false }).success).toBe(
      false,
    );
    expect(v.safeParse(MediaReportSchema, { videos: [] }).success).toBe(false);
    expect(v.safeParse(MediaOutcomeSchema, { done: 'yes' }).success).toBe(false);
    expect(v.safeParse(MediaOutcomeSchema, { done: false, error: 'x'.repeat(65) }).success).toBe(
      false,
    );
  });
});
