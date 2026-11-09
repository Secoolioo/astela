# Content blocker

> **Status:** available from 0.1.0-beta.3.

Astela blocks ads and trackers by default, as well as what pages load from known malware hosts. It uses the filter lists that uBlock Origin enables by default, except Peter Lowe's list, whose terms do not allow redistribution: uBlock filters with Badware risks, Privacy, Unbreak and Quick fixes, EasyList, EasyPrivacy, and the Online Malicious URL Blocklist. The lists come with Astela and are updated with every release.

Blocked requests never leave your computer. A page you open yourself is always loaded, even when its address is on a list; only what it loads from the lists' addresses is blocked. A warning before dangerous sites is planned. Where a list replaces a script, an image or a video with a harmless stand-in, Astela serves the stand-in of uBlock Origin, so pages that wait for the file keep working. Tracking parameters that the lists name are removed from the addresses of pages and requests, and a list can set a content security policy for a page. Astela also hides the ad spaces that the lists name on each page, including in embedded frames and elements that the lists find by their text, and applies the lists' small fixes to pages that fight ad blockers. Popups that the lists name do not open; they count as blocked on the page.

The shield next to the menu button shows how many requests the blocker stopped on the current page. Click it to open its popover, which shows that number too and counts along while the page loads. To turn the blocker off for the page's site, for example when a site does not work with it, switch off **Block ads on** followed by the site's name; the page reloads, and the shield turns gray and crossed out. The exception covers the whole site: off on `www.example.com`, the blocker is off on `shop.example.com` too. Switch it on again to turn blocking back on for the site. If the setting cannot be saved, for example because your organization manages it, Astela says so. **Content blocker settings** in the popover opens the settings. A click next to the popover or Escape closes it.

If the filter data of the installation is missing or damaged, the blocker blocks nothing: the shield turns red, and the settings page says so. Reinstalling Astela repairs it.

To turn the blocker off everywhere, open [Settings](settings.md) → Privacy and switch off **Block ads and trackers**. Organizations can set it with the policy `ContentBlockerEnabled`.

The licenses of the lists and of uBlock Origin's scriptlets are in `NOTICE.txt` in the `blocker` folder of the installation.
