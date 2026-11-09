import type { Logger } from '../../kernel/logging/logger.ts';

/**
 * A procedural rule, such as `:has-text()`: the frame finds its elements itself, then marks
 * them with the attribute that the style sheet hides, or runs the directive on them.
 */
export interface ExtendedRule {
  /** The selector of the elements, parsed. */
  readonly ast: unknown;
  /** The attribute that hides an element, for hiding rules. */
  readonly attribute?: string | undefined;
  /** What to do with an element, such as removing it, for the other rules. */
  readonly directive?: unknown;
}

/** The rules for a frame that starts. */
export interface FrameRules {
  /** Element hiding rules of the frame's address, as a style sheet. */
  readonly styles: string;
  /** Scriptlets that run in the page's world before its own scripts. */
  readonly scripts: readonly string[];
  /** Procedural rules of the frame's address. */
  readonly extended: readonly ExtendedRule[];
  /** Whether the frame should report its elements for the generic hiding rules. */
  readonly elements: boolean;
}

/** The classes, ids and link targets that a frame reported. */
export interface FrameElements {
  readonly classes: readonly string[];
  readonly ids: readonly string[];
  readonly hrefs: readonly string[];
}

/** Where the content blocker is: not loaded yet, loading, working, or without usable data. */
export type BlockerStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** A group of optional lists with an engine of its own: cookie notices or annoyances. */
export type ExtraLists = 'cookies' | 'annoyances';

/** Options of the content blocker. */
export interface ContentBlockerOptions {
  /** Folder with `engine.bin`, built by `tools/blocker/build.ts`. */
  readonly dataDir: string;
  /** Whether blocking is on for a page, by its address; read for every request. */
  readonly enabled: (pageUrl: string) => boolean;
  /** Called for every blocked request, with the id of the tab's web contents. */
  readonly onBlocked?: (webContentsId: number) => void;
  /** Called when the status of the content blocker changes. */
  readonly onStatus?: (status: BlockerStatus) => void;
  /** The groups of optional lists that are on; read for every request and frame. */
  readonly extras?: () => readonly ExtraLists[];
  readonly logger: Logger;
}
