import type { FiltersEngine, Request as EngineRequest, RequestType } from '@ghostery/adblocker';
import type { OnBeforeRequestListenerDetails, OnHeadersReceivedListenerDetails } from 'electron';
import { readFile } from 'node:fs/promises';
import { parse } from 'tldts-experimental';
import { join } from 'node:path';
import type { HeaderAdditions, RequestDecision } from '../electron/request-pipeline.ts';
import type {
  ContentBlockerOptions,
  ExtraLists,
  FrameElements,
  FrameRules,
} from './blocker-types.ts';
import { resourceUrl, type ReplacementResource } from './resource-protocol.ts';
import { withoutRemovedParameters } from '../../domain/blocker/parameters.ts';

/** The engine and the request class of the library, loaded together. */
interface LoadedEngine {
  readonly engine: FiltersEngine;
  /** An engine of the popup filters alone, matched against the addresses of popups. */
  readonly popups: FiltersEngine | undefined;
  readonly Engine: typeof FiltersEngine;
  readonly Request: typeof EngineRequest;
}

/**
 * Reads the filter data and makes the engine of the content blocker. It loads with the
 * first web page, together with this module, so the start of the browser does neither.
 * @param options - The options of the content blocker.
 * @throws When the data is missing or damaged.
 */
export async function openBlockerEngine(options: ContentBlockerOptions): Promise<BlockerEngine> {
  const [{ FiltersEngine: Engine, Request }, bytes, popupBytes] = await Promise.all([
    import('@ghostery/adblocker'),
    readFile(join(options.dataDir, 'engine.bin')),
    // The filters with `$popup`, which the engine itself does not support; optional.
    readFile(join(options.dataDir, 'popups.bin')).catch(() => undefined),
  ]);
  const engine = Engine.deserialize(new Uint8Array(bytes));
  const popups =
    popupBytes === undefined ? undefined : Engine.deserialize(new Uint8Array(popupBytes));
  options.logger.info('Content blocker ready', { bytes: bytes.length });
  return new BlockerEngine({ engine, popups, Engine, Request }, options);
}

/** The loaded filter engines and what the content blocker asks of them. */
export class BlockerEngine {
  /** The engines of optional lists by group, once asked for; `null` without usable data. */
  private readonly extras = new Map<ExtraLists, Promise<FiltersEngine | null>>();
  private readonly loadedExtras = new Map<ExtraLists, FiltersEngine | null>();
  private readonly loaded: LoadedEngine;
  private readonly options: ContentBlockerOptions;

  /**
   * @param loaded - The engines and the library's request class.
   * @param options - The options of the content blocker.
   */
  constructor(loaded: LoadedEngine, options: ContentBlockerOptions) {
    this.loaded = loaded;
    this.options = options;
    for (const group of options.extras?.() ?? []) void this.loadExtra(group);
  }

  /**
   * Takes the tracking parameters that the lists name out of the address of a page; pages
   * themselves are never blocked.
   * @param url - The page's address.
   */
  mainFrame(url: string): RequestDecision | undefined {
    const page = this.loaded.Request.fromRawDetails({ url, sourceUrl: url, type: 'main_frame' });
    return withoutTrackingParameters(url, this.loaded.engine.match(page).rewrite?.url);
  }

  /**
   * Decides about a request that a page makes.
   * @param details - The request.
   * @param sourceUrl - The page it belongs to.
   * @param type - Its type for the filter engine.
   */
  subresource(
    details: OnBeforeRequestListenerDetails,
    sourceUrl: string,
    type: RequestType,
  ): RequestDecision | undefined {
    const request = this.loaded.Request.fromRawDetails({ url: details.url, sourceUrl, type });
    const main = this.loaded.engine.match(request);
    const result = main.match
      ? main
      : this.extraEngines()
          .map((engine) => engine.match(request))
          .find((extra) => extra.match);
    if (result === undefined) {
      // Tracking parameters leave the address of a request that is not blocked.
      return withoutTrackingParameters(details.url, main.rewrite?.url);
    }
    if (details.webContentsId !== undefined) {
      this.options.onBlocked?.(details.webContentsId);
    }
    // A harmless stand-in keeps pages working that wait for the file they asked for.
    return result.redirect === undefined
      ? { cancel: true }
      : { redirectURL: resourceUrl(result.redirect.filename) };
  }

  /**
   * Adds the content security policy that `$csp` filters set for a page.
   * @param details - The response of a page.
   */
  headersReceived(details: OnHeadersReceivedListenerDetails): HeaderAdditions | undefined {
    const directives = this.loaded.engine.getCSPDirectives(
      this.loaded.Request.fromRawDetails({
        url: details.url,
        sourceUrl: details.url,
        type: 'main_frame',
      }),
    );
    return directives === undefined ? undefined : { 'Content-Security-Policy': [directives] };
  }

  /**
   * A replacement resource of the filter data by its file name, for the resource scheme.
   * @param name - The file name.
   */
  resource(name: string): ReplacementResource | undefined {
    const resource = this.loaded.engine.resources.getResource(name);
    return resource === undefined
      ? undefined
      : { body: resource.body, contentType: resource.contentType };
  }

  /**
   * The element hiding rules, procedural rules and scriptlets for a frame that starts.
   * @param url - The frame's address.
   */
  frameRules(url: string): FrameRules {
    const address = this.address(url);
    const results = [this.loaded.engine, ...this.extraEngines()].map((engine) =>
      engine.getCosmeticsFilters({ ...address, getRulesFromDOM: false, getExtendedRules: true }),
    );
    return {
      styles: results
        .map((result) => result.styles)
        .filter((styles) => styles !== '')
        .join('\n'),
      scripts: results.flatMap((result) => result.scripts),
      extended: results.flatMap((result) =>
        result.extended.map(({ ast, attribute, directive }) => ({ ast, attribute, directive })),
      ),
      elements: true,
    };
  }

  /**
   * The generic element hiding rules for the classes, ids and links of a frame.
   * @param url - The frame's address.
   * @param elements - What the frame reported.
   */
  elementRules(url: string, elements: FrameElements): string {
    const address = this.address(url);
    return [this.loaded.engine, ...this.extraEngines()]
      .map(
        (engine) =>
          engine.getCosmeticsFilters({
            ...address,
            classes: [...elements.classes],
            ids: [...elements.ids],
            hrefs: [...elements.hrefs],
            getBaseRules: false,
            getInjectionRules: false,
            getExtendedRules: false,
            getRulesFromHostname: false,
            getRulesFromDOM: true,
          }).styles,
      )
      .filter((styles) => styles !== '')
      .join('\n');
  }

  /**
   * The registrable domain of a page, such as `example.co.uk` for `www.example.co.uk`. Sites
   * on hosting platforms count as sites of their own, such as `alice.github.io`.
   * @param url - The page's address.
   */
  domainOf(url: string): string {
    const { domain, hostname } = parse(url, { allowPrivateDomains: true });
    return domain ?? hostname ?? '';
  }

  /**
   * Whether a popup that a page opens is one that the filter lists block.
   * @param url - The address the popup would show.
   * @param openerUrl - The address of the page that opens it.
   */
  blocksPopup(url: string, openerUrl: string): boolean {
    if (this.loaded.popups === undefined) return false;
    // Not as a page of its own: the engine counts every page as first-party, so filters for
    // popups from other sites would never apply.
    const request = this.loaded.Request.fromRawDetails({
      url,
      sourceUrl: openerUrl,
      type: 'other',
    });
    return this.loaded.popups.match(request).match;
  }

  /**
   * Loads the engines of the optional lists that are on, so that they apply from the next
   * request on; a group whose engine has loaded already costs nothing.
   */
  async loadExtras(): Promise<void> {
    await Promise.all((this.options.extras?.() ?? []).map((group) => this.loadExtra(group)));
  }

  /**
   * The engines of the optional lists that are on and have loaded. A group that is on but
   * not loaded yet starts to load and applies from a later request on, because requests and
   * frames do not wait for it.
   */
  private extraEngines(): FiltersEngine[] {
    const engines: FiltersEngine[] = [];
    for (const group of this.options.extras?.() ?? []) {
      const engine = this.loadedExtras.get(group);
      if (engine === undefined) void this.loadExtra(group);
      else if (engine !== null) engines.push(engine);
    }
    return engines;
  }

  private loadExtra(group: ExtraLists): Promise<FiltersEngine | null> {
    let extra = this.extras.get(group);
    if (extra === undefined) {
      extra = readFile(join(this.options.dataDir, `${group}.bin`))
        .then((bytes) => {
          const engine = this.loaded.Engine.deserialize(new Uint8Array(bytes));
          // The optional engines use the scriptlets and stand-ins of the main engine.
          engine.resources = this.loaded.engine.resources;
          this.options.logger.info('Optional filter lists ready', { group, bytes: bytes.length });
          return engine;
        })
        .catch((error: unknown) => {
          this.options.logger.warn('Optional filter lists are missing or invalid', {
            group,
            error: String(error),
          });
          return null;
        })
        .then((engine) => {
          this.loadedExtras.set(group, engine);
          return engine;
        });
      this.extras.set(group, extra);
    }
    return extra;
  }

  /** The parts of an address that cosmetic rules need. */
  private address(url: string): { url: string; hostname: string; domain: string } {
    const { hostname, domain } = this.loaded.Request.fromRawDetails({ url });
    return { url, hostname, domain };
  }
}

/**
 * The redirect that takes the tracking parameters out of an address, if the engine took any.
 * @param url - The address of the request.
 * @param rewritten - The address that the engine made of it, if any.
 */
function withoutTrackingParameters(
  url: string,
  rewritten: string | undefined,
): RequestDecision | undefined {
  if (rewritten === undefined || rewritten === url) return undefined;
  const cleaned = withoutRemovedParameters(url, rewritten);
  return cleaned === url ? undefined : { redirectURL: cleaned };
}
