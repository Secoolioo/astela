# Content blocker

> **Status:** available from 0.1.0-beta.3.

Astela blocks ads, trackers and known malware sites by default. It uses the filter lists that uBlock Origin enables by default: uBlock filters with Badware risks, Privacy, Unbreak and Quick fixes, EasyList, EasyPrivacy, and the Online Malicious URL Blocklist. The lists come with Astela and are updated with every release.

Blocked requests never leave your computer. A page you open yourself is always loaded; only what it loads from the lists' addresses is blocked. Astela also hides the ad spaces that the lists name on each page, including in embedded frames, and applies the lists' small fixes to pages that fight ad blockers.

The shield next to the menu button shows how many requests the blocker stopped on the current page. Click it to turn the blocker off for the page's site, for example when a site does not work with it; the page reloads, and the shield turns gray. Click it again to turn blocking back on for the site.

To turn the blocker off everywhere, open [Settings](settings.md) → Privacy and switch off **Block ads and trackers**. Organizations can set it with the policy `ContentBlockerEnabled`.

The licenses of the lists and of uBlock Origin's scriptlets are in `NOTICE.txt` in the `blocker` folder of the installation.
