# Content blocker

> **Status:** available from 0.1.0-beta.3.

Astela blocks ads and trackers by default, as well as what pages load from known malware hosts. It uses the filter lists that uBlock Origin enables by default, except Peter Lowe's list, whose terms do not allow redistribution: uBlock filters with Badware risks, Privacy, Unbreak and Quick fixes, EasyList, EasyPrivacy, and the Online Malicious URL Blocklist. The lists come with Astela and are updated with every release.

Blocked requests never leave your computer. A page you open yourself is always loaded, even when its address is on a list; only what it loads from the lists' addresses is blocked. A warning before dangerous sites is planned. Where a list replaces a script with a harmless one of uBlock Origin's resources, Astela blocks the script instead for now; on the rare page that breaks, turn the blocker off for the site. Astela also hides the ad spaces that the lists name on each page, including in embedded frames, and applies the lists' small fixes to pages that fight ad blockers.

The shield next to the menu button shows how many requests the blocker stopped on the current page. Click it to open its menu, which shows that number too. To turn the blocker off for the page's site, for example when a site does not work with it, choose **Block ads on** followed by the site's name, so that it is no longer checked; the page reloads, and the shield turns gray and crossed out. Choose the item again to turn blocking back on for the site. **Content blocker settings** in the same menu opens the settings.

To turn the blocker off everywhere, open [Settings](settings.md) → Privacy and switch off **Block ads and trackers**. Organizations can set it with the policy `ContentBlockerEnabled`.

The licenses of the lists and of uBlock Origin's scriptlets are in `NOTICE.txt` in the `blocker` folder of the installation.
