# 0061. Pop-up blocker and compact popups

## Status

Accepted. Amends [ADR 0040](0040-tabs-and-popups-that-keep-their-opener.md): a page opens a window only after an input of a person, and a popup gets the page size that it asked for and a frame without tabs, which ends its drawback **Popups are full windows**. Amends [ADR 0038](0038-site-permissions-asked-in-the-overlay.md), whose setting `permissions.sites` also keeps the sites that may open pop-ups without a click. Built in 0.1.0-beta.7, after the early test of the newest build.

## Date

2026-11-15

## Context

The early test of the build with picture in picture compared the browser with plain Chromium and found two problems with the windows that pages open:

- **No pop-up blocker:** a page that called `window.open` from its load event or from a timer, without any click, opened new tabs, and nothing showed that it did; only the `$popup` filters of the content blocker stopped known ad hosts. Chromium blocks both, and its address bar offers to show them and to always allow the site. Electron runs no pop-up blocker of Chromium, and the details of its window open handler carry no flag for a gesture of the user; Chromium's own check of the transient activation in the browser process is passed to `CanCreateWindow`, which Electron answers without it.
- **Popups too small and too full:** a popup took the size that the page asked for as the size of its window, so its page lost the room of the toolbar and the tab strip, 343 of the 420 pixels asked, and 280 pixels of width with the tabs at a side. The popup also carried the full tab strip with its New tab button, so people could open other tabs in a sign-in window, which the session lost at the next start, as it keeps no popup. CSSOM View and other browsers take `width` and `height` for the size of the page, and Chrome shows such windows in a compact frame with an address that cannot be edited.

## Decision

- **An input lets a page open one window:** the browser process notes the input that people give each web page, as Chromium's transient activation, and a page may open a window, a tab or a popup only within five seconds of such an input, also with a link or a form that a script clicks or submits. The window uses the input up, so that one click opens one window (`Activations` in `app/src/domain/navigation/popup-activation.ts`, `pageActivations` in `app/src/platform/electron/page-activation.ts`). The filter lists still come first and count in the shield.
- **What counts as an input:** a press of a mouse button in any frame of the page (`before-mouse-event`, which also sees frames of other sites and the pages that pages opened), a touch or a tap in its top frame (`input-event`), and a key that reached the page and that no shortcut of the browser took (`typed` in `app/src/platform/electron/web-pages.ts`). As in Chromium, Escape and the modifier keys count as none: Control, Alt, Shift, Meta and the others start every shortcut of the browser and of the system, such as `Ctrl+T` or `Alt+Tab`, and the window takes only the key that follows them. The view of the reader view counts its own clicks, so that a middle click on one of its links opens the link in a new tab, as on the page (`app/src/main/reader.ts`).
- **A click that only the page sees:** screen readers and voice control click through the accessibility of the page, which gives the frame an activation in Blink without an input event of the browser process. The frame preload therefore listens to clicks in each frame, and reports one with `page.activation` while `navigator.userActivation.isActive` is true, at most every 100 ms (`app/src/preload/frame.ts`). A page cannot send such a report without an input of a person, as only that activates a frame, and a window that it opens uses the activation up in Blink as well. The browser process counts the reports only for the pages of tabs that it follows.
- **A new document starts without one:** when the main frame of a page commits another document (`did-navigate`), the page loses its input, so the page that a click led to in the same tab, or a redirect after it, opens nothing by itself, as in Chromium, which resets the activation of a frame for a navigation.
- **Blocked pop-ups:** what else a page opens does not open. Its tab counts it (`TabView.popups`, reset when the page goes to another document), a chip in the address bar shows the count, and its popover lists the latest 20 addresses, opens one in a tab next to the page, and lets people always allow the site's pop-ups (`BlockedPopups` in `app/src/domain/navigation/blocked-popups.ts`, `app/src/main/popup-blocker.ts`). An address longer than the 8192 characters that the channels of the popover take only counts; the popover says that it cannot list it, and still lets people allow the site.
- **Allowing a site:** the decision is a site permission, `popups` in `permissions.sites`, which no site can ask for and which the settings page and site information ([ADR 0059](0059-site-information-with-checked-certificates.md)) list, change and reset with the others; a private window keeps it until its last window closes.
- **The page size of a popup:** the size that a page asks for, with `width` or `innerWidth` and `height` or `innerHeight`, is that of its page, so the window is as much larger as its toolbar takes, the line below it included (`popupFrame` in `app/src/domain/windows/popup-bounds.ts`); the smallest window and the screen limit the result, and a popup that asks for no size gets a window of 800 × 600. The window takes the size as the size of its content (`useContentSize`), so the title bar of the system adds to it; once the window is open, a window that the frame of the system takes beyond the work area moves and shrinks to fit it (`fittedPopup`).
- **Compact popups:** a popup has no tab strip, no New tab button and no bookmarks bar, whatever the setting `tabs.position` says; its toolbar is the top row with the window controls, and its address cannot be edited (`ShellState.popup`). As a popup shows only its page, a tab that it would open opens in the regular window, or private one, that had the focus last and shows the popup's workspace, or in a new one: the tabs and links that its page opens, `Ctrl+T`, **Duplicate the tab** and a new tab of the command palette or a shortcut, the context menu and the browser's own pages from its menu (`app/src/platform/electron/popup-windows.ts`). The session keeps those tabs, as it keeps no popup.

### Deviations from the plan

- The plans numbered this decision as part of ADR 0040; [ADR 0001](0001-record-architecture-decisions.md) keeps accepted records as they are, so it is a record of its own.
- The plan keeps the time of the last input in `guardWebContents` (`session-security.ts`), which is on the start-up path. The inputs are followed with the code for web pages, which loads before the first web page, and the keys come from the window, which knows its shortcuts.
- The plan names inputs of the browser process only. The report of the frame preload is added for the clicks of screen readers and voice control, which no input event shows.
- The plan gives `adopt` and `TabService.open` a workspace, so that a popup's tabs open in its workspace. They open in a regular window that shows that workspace instead, or in a new one, which needs no change of the tab service.
- The plan for the page size reads the room of the shell from the opener's window. A popup has a frame of its own, without the tab strip, so it takes the toolbar's row of its density with its line.

## Consequences

Positive:

- Pages that open windows by themselves, from their load event, a timer or a frame of another site, or after the click that led to them, open nothing, as in Chromium, and people see what was blocked and can open it or allow the site.
- Screen readers and voice control open sign-in popups and links in new tabs as a click of the mouse does.
- Sign-in and payment pages get the size that they ask for, and their popups have no tabs that people could lose.

Negative:

- **One window per input:** a page that opens two windows for one click, such as a payment page that opens its window and a help page, opens only the first; people open the other from the chip of the pop-up blocker or allow the site.
- **Input of the whole page:** the input counts for the page, not for the frame that got it, so a frame of another site in a page could use a click that went to the page within the five seconds; Chromium keeps activations per frame. The browser process cannot tell which frame opens a window.
- **Reports renew the input:** a page that got an input and opened no window can click its own elements by script within the five seconds, so that its frame preload reports them; it may then open one window up to ten seconds after the input, not five.
- **Frames without the frame preload:** a click of a screen reader in a frame of a page that a page opened counts as no input, as Electron leaves out the frame preload there ([ADR 0040](0040-tabs-and-popups-that-keep-their-opener.md)); the top document of such a page reports its clicks. A touch inside a frame of another site is no input that the browser process sees; only the click that follows the tap counts, through the frame preload, unless the page cancels it.
- **Long addresses:** a blocked pop-up with an address longer than 8192 characters cannot be opened from the popover, only by allowing the site.
- **The system's title bar:** with the title bar of the system, a popup as large as the screen opens a little smaller than its page asked for, as its window shrinks to fit once it is open.

## Alternatives considered

- **Reporting the activation of the page at each `window.open`:** the frame preload cannot see the calls of the page's own world without replacing `window.open` there, which the page can undo, and links and forms open windows without it.
- **Activations per frame, as in Chromium:** the details of the window open handler do not name the frame that opens the window.
- **Dropping the input when a navigation starts:** it would also block a window that a page opens in the same click after it sets `location`, which Chromium allows; the commit of the new document is where Chromium resets it.
- **Measuring the frame of the system on the opener's window before the popup opens:** it is wrong for an opener in full screen, and the window that opens knows its frame itself.
- **A full window for popups, with a setting for a compact one:** it keeps the problem for everyone who does not find the setting.
