import type { PayloadOf, RequestOf, ResponseOf } from '../../shared/ipc/contract.ts';
import type {
  OpenProtectedMedia,
  ProtectedMediaChanged,
} from '../../shared/ipc/media-contracts.ts';
import type {
  ActivateTab,
  CloseTab,
  GetShellState,
  NavigateTab,
  OpenTab,
  SetShellInsets,
  ShellCommand,
  ShellState,
  TabAction,
} from '../../shared/ipc/shell-contracts.ts';
import type {
  FindInPage,
  OpenBlockerPopover,
  OpenBookmarkFolder,
  OpenBookmarkPopover,
  OpenDownloads,
  OpenMenu,
  PrepareOverlay,
  ProceedInsecurely,
  ProceedUnsafely,
  ReopenClosedTab,
  ResetZoom,
  SetTabMuted,
  GetFavicon,
  MoveTab,
  OpenTabMenu,
  SuggestAddresses,
  SelectSuggestion,
  AcceptSuggestion,
  CloseSuggestions,
  ResizeSplit,
  StopFinding,
  ToggleGroup,
  OpenGroupEditor,
  EditGroupRequested,
  OpenWorkspaces,
  MoveTabToWorkspace,
  ToggleReader,
  TogglePictureInPicture,
  HoldTopRows,
  OpenSiteInfo,
} from '../../shared/ipc/shell-later-contracts.ts';

interface Requests {
  'shell.getState': typeof GetShellState;
  'tabs.open': typeof OpenTab;
  'tabs.activate': typeof ActivateTab;
  'tabs.close': typeof CloseTab;
  'tabs.reopenClosed': typeof ReopenClosedTab;
  'tabs.navigate': typeof NavigateTab;
  'tabs.action': typeof TabAction;
  'shell.setInsets': typeof SetShellInsets;
  'shell.openProtectedMedia': typeof OpenProtectedMedia;
  'shell.openMenu': typeof OpenMenu;
  'shell.openBlockerPopover': typeof OpenBlockerPopover;
  'shell.openDownloads': typeof OpenDownloads;
  'tabs.proceedUnsafely': typeof ProceedUnsafely;
  'tabs.proceedInsecurely': typeof ProceedInsecurely;
  'tabs.find': typeof FindInPage;
  'tabs.stopFind': typeof StopFinding;
  'tabs.resetZoom': typeof ResetZoom;
  'shell.openBookmarkPopover': typeof OpenBookmarkPopover;
  'shell.openBookmarkFolder': typeof OpenBookmarkFolder;
  'shell.prepareOverlay': typeof PrepareOverlay;
  'tabs.favicon': typeof GetFavicon;
  'tabs.setMuted': typeof SetTabMuted;
  'tabs.move': typeof MoveTab;
  'tabs.openMenu': typeof OpenTabMenu;
  'omnibox.suggest': typeof SuggestAddresses;
  'omnibox.select': typeof SelectSuggestion;
  'omnibox.accept': typeof AcceptSuggestion;
  'omnibox.close': typeof CloseSuggestions;
  'tabs.resizeSplit': typeof ResizeSplit;
  'groups.toggle': typeof ToggleGroup;
  'groups.openEditor': typeof OpenGroupEditor;
  'workspaces.open': typeof OpenWorkspaces;
  'workspaces.moveTab': typeof MoveTabToWorkspace;
  'shell.toggleReader': typeof ToggleReader;
  'shell.togglePictureInPicture': typeof TogglePictureInPicture;
  'shell.holdTopRows': typeof HoldTopRows;
  'shell.openSiteInfo': typeof OpenSiteInfo;
}

interface Events {
  'shell.stateChanged': ShellState;
  'shell.command': PayloadOf<typeof ShellCommand>;
  'shell.editGroup': PayloadOf<typeof EditGroupRequested>;
  'shell.protectedMedia': PayloadOf<typeof ProtectedMediaChanged>;
}

/** The API that the shell's preload script exposes. */
interface PreloadBridge {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    readonly bridge: PreloadBridge;
  }
}

/** Typed access to the browser process from the shell. */
export class ShellBridge {
  private readonly raw: PreloadBridge;

  /** @param raw - The preload bridge, `window.bridge`. */
  constructor(raw: PreloadBridge) {
    this.raw = raw;
  }

  /**
   * Calls a request channel.
   * @param channel - The channel.
   * @param request - The request; the browser process validates it again.
   */
  invoke<K extends keyof Requests>(
    channel: K,
    request: RequestOf<Requests[K]>,
  ): Promise<ResponseOf<Requests[K]>> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser process validates every response against the contract
    return this.raw.invoke(channel, request) as Promise<ResponseOf<Requests[K]>>;
  }

  /**
   * Listens to an event channel.
   * @param channel - The channel.
   * @param listener - Receives each payload.
   * @returns A function that removes the listener.
   */
  on<K extends keyof Events>(channel: K, listener: (payload: Events[K]) => void): () => void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser process only publishes payloads of the event contract
    return this.raw.on(channel, (payload) => listener(payload as Events[K]));
  }
}
