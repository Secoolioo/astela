import {
  bestVideo,
  mediaLimits,
  type MediaOutcome,
  type MediaPoint,
  type MediaReport,
  type MediaRequest,
  type VideoReport,
} from '../domain/media/media.ts';

/**
 * The media script of the browser, for picture in picture. The browser runs it in its isolated
 * world 1002 in the main frame of a page, and in the frame's own world in a frame of another
 * site. It reports the videos of its frame, of the frames of the same origin in it and of their
 * open shadow roots, and shows one of them in picture in picture or ends picture in picture,
 * for a click on the browser's own button or menu: the browser gives the frame the activation
 * that this needs. It acts only in the document that the browser chose, and changes nothing
 * else of the page.
 * @param request - What the browser asks.
 */
export function run(request: MediaRequest): MediaReport | Promise<MediaOutcome> {
  if (request.kind === 'probe') {
    const found = collect();
    return {
      videos: found.videos.map(describe),
      pip: found.documents.some((owner) => owner.pictureInPictureElement !== null),
    };
  }
  // The browser chose a video of one document: another one that its frame shows now, after a
  // navigation, is none of its business.
  if (location.href !== request.page) return Promise.resolve({ done: false, error: 'OtherPage' });
  if (request.kind === 'exit') return exit();
  return request.kind === 'enter'
    ? enter(collect().videos[request.index], request.until)
    : enter(videoAt(request.point, request.src), request.until);
}

/** The videos and the documents of the frame, in the order of the documents. */
interface Found {
  readonly videos: HTMLVideoElement[];
  readonly documents: Document[];
}

/**
 * Finds the videos of the frame's document, of its open shadow roots and of the frames of its
 * origin in it, down to `mediaLimits.depth`, at most `mediaLimits.videos` of them. Frames of
 * other origins have no document here; the browser asks them on their own.
 */
function collect(): Found {
  const found: Found = { videos: [], documents: [] };
  let left: number = mediaLimits.elements;
  const walk = (root: Document | ShadowRoot, owner: Document, depth: number): void => {
    // The elements of the document of another frame have the classes of that frame.
    const realm = owner.defaultView;
    if (realm === null) return;
    const walker = owner.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      left -= 1;
      if (left < 0 || found.videos.length >= mediaLimits.videos) return;
      if (node instanceof realm.HTMLVideoElement) found.videos.push(node);
      if (node instanceof realm.Element && node.shadowRoot !== null) {
        walk(node.shadowRoot, owner, depth);
      }
      const inner =
        depth > 0 &&
        (node instanceof realm.HTMLIFrameElement || node instanceof realm.HTMLFrameElement)
          ? node.contentDocument
          : null;
      if (inner !== null) {
        found.documents.push(inner);
        walk(inner, inner, depth - 1);
      }
    }
  };
  found.documents.push(document);
  walk(document, document, mediaLimits.depth);
  return found;
}

/** What a video tells about itself, with the area of it that shows in its viewport. */
function describe(video: HTMLVideoElement): VideoReport {
  const owner = video.ownerDocument;
  const view = owner.defaultView;
  const box = video.getBoundingClientRect();
  const width = Math.min(box.right, view?.innerWidth ?? 0) - Math.max(box.left, 0);
  const height = Math.min(box.bottom, view?.innerHeight ?? 0) - Math.max(box.top, 0);
  const area = width > 0 && height > 0 ? Math.round(width * height) : 0;
  return {
    ready:
      video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      video.videoWidth > 0 &&
      !video.disablePictureInPicture &&
      owner.pictureInPictureEnabled,
    playing: !video.paused && !video.ended,
    audible: !video.muted && video.volume > 0,
    area: Math.min(area, mediaLimits.area),
  };
}

/**
 * The video that a context menu was opened for: the topmost video at the point of the main frame
 * with the address, else the first video with the address, else the video that suits picture in
 * picture best.
 */
function videoAt(point: MediaPoint | null, src: string): HTMLVideoElement | undefined {
  const { videos } = collect();
  const matches = (video: HTMLVideoElement): boolean => src === '' || video.currentSrc === src;
  if (point !== null) {
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      if (element instanceof HTMLVideoElement && matches(element)) return element;
    }
  }
  const best = bestVideo(videos.map(describe));
  return videos.find((video) => src !== '' && video.currentSrc === src) ?? videos[best ?? -1];
}

/** Shows a video in picture in picture, unless its time is over. */
async function enter(video: HTMLVideoElement | undefined, until: number): Promise<MediaOutcome> {
  if (video === undefined) return { done: false, error: 'NoVideo' };
  if (Date.now() > until) return { done: false, error: 'Late' };
  try {
    await video.requestPictureInPicture();
    return { done: true };
  } catch (error) {
    return { done: false, error: errorName(error) };
  }
}

/** Ends picture in picture in the documents of the frame that show a video in it. */
async function exit(): Promise<MediaOutcome> {
  const shown = collect().documents.filter((owner) => owner.pictureInPictureElement !== null);
  try {
    for (const owner of shown) await owner.exitPictureInPicture();
    return { done: shown.length > 0 };
  } catch (error) {
    return { done: false, error: errorName(error) };
  }
}

/**
 * The name of an error, for the browser's log. Errors of the documents of frames come from
 * other realms, so their name is read rather than their class.
 */
function errorName(error: unknown): string {
  const name: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'name') : undefined;
  return typeof name === 'string' ? name.slice(0, 64) : 'Error';
}
