/**
 * What the browser's media script tells of the videos of a frame, and what the browser asks it,
 * for picture in picture. Types, limits and the ranking of videos only, so that the page script
 * needs no schema library; the browser process checks every report against
 * `picture-in-picture.ts`.
 */

/** The most that the media script reports, and that the browser asks. */
export const mediaLimits = {
  /** The videos that a frame reports, in the order of its documents. */
  videos: 32,
  /** The frames of a page that the browser asks, the main frame among them. */
  frames: 16,
  /** How deep the script looks into the frames of its own origin in its frame. */
  depth: 3,
  /** The elements that the script looks at for videos and open shadow roots. */
  elements: 20_000,
  /** The largest area that a video reports, in square CSS pixels. */
  area: 100_000_000,
} as const;

/** A video of a frame, as the media script sees it. */
export interface VideoReport {
  /**
   * Whether it can show in picture in picture: it has a picture, and neither the page nor the
   * policy of its frame forbids it.
   */
  readonly ready: boolean;
  /** Whether it plays. */
  readonly playing: boolean;
  /** Whether it plays with sound: it is not muted, and its volume is above zero. */
  readonly audible: boolean;
  /** How much of it shows in its viewport, in square CSS pixels. */
  readonly area: number;
}

/**
 * The videos of a frame, with those of the frames of its origin in it and of its open shadow
 * roots, and whether one of them shows in picture in picture.
 */
export interface MediaReport {
  readonly videos: readonly VideoReport[];
  readonly pip: boolean;
}

/** A point of the main frame of a page, in CSS pixels of its viewport. */
export interface MediaPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What the browser asks the media script: to report the videos (`probe`), to show the video at
 * a place of the report in picture in picture (`enter`), to end picture in picture (`exit`), or
 * to show the video that a context menu was opened for (`enterAt`): the video at the point of
 * the main frame, else one with the address, else the best one. A request that acts names the
 * address of the document that the browser chose (`page`) and does nothing in another one, as
 * the frame may have loaded another document since. A request that shows a video does nothing
 * once the time `until` is over, in milliseconds of the clock, as a call that waited could come
 * long after the click.
 */
export type MediaRequest =
  | { readonly kind: 'probe' }
  | {
      readonly kind: 'enter';
      readonly index: number;
      readonly until: number;
      readonly page: string;
    }
  | { readonly kind: 'exit'; readonly page: string }
  | {
      readonly kind: 'enterAt';
      readonly point: MediaPoint | null;
      readonly src: string;
      readonly until: number;
      readonly page: string;
    };

/** What came of a request that acts, with the name of the error when it failed. */
export interface MediaOutcome {
  readonly done: boolean;
  readonly error?: string;
}

/**
 * How well a video suits picture in picture, higher being better: one that plays with sound,
 * then one that plays, then one that has a picture; `0` for one that cannot show in picture in
 * picture.
 * @param video - The video.
 */
export function videoRank(video: VideoReport): number {
  if (!video.ready) return 0;
  return video.playing ? (video.audible ? 3 : 2) : 1;
}

/**
 * The place of the video that suits picture in picture best in a list: the best rank, then the
 * largest area that shows; the first of equal ones.
 * @param videos - The videos.
 * @returns The place, or `undefined` when none can show in picture in picture.
 */
export function bestVideo(videos: readonly VideoReport[]): number | undefined {
  let best: number | undefined;
  for (const [index, video] of videos.entries()) {
    const current = best === undefined ? undefined : videos[best];
    if (videoRank(video) === 0) continue;
    if (
      current === undefined ||
      videoRank(video) > videoRank(current) ||
      (videoRank(video) === videoRank(current) && video.area > current.area)
    ) {
      best = index;
    }
  }
  return best;
}
