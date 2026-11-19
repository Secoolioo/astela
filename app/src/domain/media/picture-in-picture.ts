import * as v from 'valibot';
import type { PictureInPictureState } from '../../shared/page-tools.ts';
import { bestVideo, mediaLimits, videoRank, type MediaReport } from './media.ts';

/** A video of a frame, as the browser process checks the report of the media script. */
const VideoReportSchema = v.strictObject({
  ready: v.boolean(),
  playing: v.boolean(),
  audible: v.boolean(),
  area: v.pipe(v.number(), v.minValue(0), v.maxValue(mediaLimits.area)),
});

/**
 * The report of the media script of a frame, which the browser process checks before it uses
 * anything of it: a page can change what the script reads.
 */
export const MediaReportSchema = v.strictObject({
  videos: v.pipe(v.array(VideoReportSchema), v.maxLength(mediaLimits.videos)),
  pip: v.boolean(),
});

/** What came of a request of the media script that acts. */
export const MediaOutcomeSchema = v.strictObject({
  done: v.boolean(),
  error: v.exactOptional(v.pipe(v.string(), v.maxLength(64))),
});

/**
 * What the button of picture in picture does with the videos of a page: end picture in picture
 * in the frame whose video shows in it, or show a video of a frame in picture in picture. Frames
 * are counted in the order of their reports, the main frame first.
 */
export type VideoChoice =
  | { readonly kind: 'exit'; readonly frame: number }
  | { readonly kind: 'enter'; readonly frame: number; readonly video: number };

/**
 * Chooses the video of a page that picture in picture is about: a video that shows in picture in
 * picture first, to end it; else the video that plays with sound and shows the largest, then the
 * largest that plays, then the largest that has a picture. The main frame wins over other frames
 * with an equal video.
 * @param frames - The reports of the frames, the main frame first.
 * @returns The choice, or `undefined` for a page without a video that can show.
 */
export function chooseVideo(frames: readonly MediaReport[]): VideoChoice | undefined {
  const shown = frames.findIndex((frame) => frame.pip);
  if (shown !== -1) return { kind: 'exit', frame: shown };
  let choice: { readonly frame: number; readonly video: number } | undefined;
  for (const [frame, report] of frames.entries()) {
    const video = bestVideo(report.videos);
    const candidate = video === undefined ? undefined : report.videos[video];
    if (video === undefined || candidate === undefined) continue;
    const current = choice === undefined ? undefined : frames[choice.frame]?.videos[choice.video];
    if (
      current === undefined ||
      videoRank(candidate) > videoRank(current) ||
      (videoRank(candidate) === videoRank(current) && candidate.area > current.area)
    ) {
      choice = { frame, video };
    }
  }
  return choice === undefined ? undefined : { kind: 'enter', ...choice };
}

/**
 * What the button of picture in picture shows for a page: `open` while one of its videos shows
 * in picture in picture, `available` while a video that can show plays, and `none` otherwise.
 * @param frames - The reports of the frames of the page.
 */
export function pictureInPictureState(frames: readonly MediaReport[]): PictureInPictureState {
  if (frames.some((frame) => frame.pip)) return 'open';
  return frames.some((frame) => frame.videos.some((video) => video.ready && video.playing))
    ? 'available'
    : 'none';
}
