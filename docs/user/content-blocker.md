# Content blocker

> **Status:** available from 0.1.0-beta.3.

Astela blocks ads, trackers and known malware sites by default. It uses the filter lists that uBlock Origin enables by default: uBlock filters with Badware risks, Privacy, Unbreak and Quick fixes, EasyList, EasyPrivacy, and the Online Malicious URL Blocklist. The lists come with Astela and are updated with every release.

Blocked requests never leave your computer. A page you open yourself is always loaded; only what it loads from the lists' addresses is blocked.

To turn the blocker off, open [Settings](settings.md) → Privacy and switch off **Block ads and trackers**. Organizations can set it with the policy `ContentBlockerEnabled`.

The licenses of the lists and of uBlock Origin's scriptlets are in `NOTICE.txt` in the `blocker` folder of the installation.
