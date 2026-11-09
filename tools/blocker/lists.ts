/** A filter list that the blocker uses, with its license. */
export interface FilterList {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly homepage: string;
  readonly license: string;
}

const uAssets = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/';
const uAssetsCdn = 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/thirdparties/';
const ublockHome = 'https://github.com/uBlockOrigin/uAssets';
const easyListHome = 'https://easylist.to/';

/**
 * The lists that uBlock Origin enables by default (`assets/assets.json` of uBlock Origin
 * 1.75), except Peter Lowe's list, whose terms do not allow redistribution in a product.
 * The uBlock lists and EasyList come from the repositories that uBlock Origin itself uses.
 */
export const filterLists: readonly FilterList[] = [
  {
    id: 'ublock-filters',
    name: 'uBlock filters',
    url: `${uAssets}filters.txt`,
    homepage: ublockHome,
    license: 'GPL-3.0',
  },
  {
    id: 'ublock-badware',
    name: 'uBlock filters – Badware risks',
    url: `${uAssets}badware.txt`,
    homepage: ublockHome,
    license: 'GPL-3.0',
  },
  {
    id: 'ublock-privacy',
    name: 'uBlock filters – Privacy',
    url: `${uAssets}privacy.txt`,
    homepage: ublockHome,
    license: 'GPL-3.0',
  },
  {
    id: 'ublock-unbreak',
    name: 'uBlock filters – Unbreak',
    url: `${uAssets}unbreak.txt`,
    homepage: ublockHome,
    license: 'GPL-3.0',
  },
  {
    id: 'ublock-quick-fixes',
    name: 'uBlock filters – Quick fixes',
    url: `${uAssets}quick-fixes.txt`,
    homepage: ublockHome,
    license: 'GPL-3.0',
  },
  {
    id: 'easylist',
    name: 'EasyList',
    url: `${uAssetsCdn}easylist.txt`,
    homepage: easyListHome,
    license: 'GPL-3.0 or CC-BY-SA-3.0',
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: `${uAssetsCdn}easyprivacy.txt`,
    homepage: easyListHome,
    license: 'GPL-3.0 or CC-BY-SA-3.0',
  },
  {
    id: 'urlhaus',
    name: 'Online Malicious URL Blocklist',
    url: 'https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt',
    homepage: 'https://gitlab.com/malware-filter/urlhaus-filter',
    license: 'CC0-1.0 (data from URLhaus) and MIT',
  },
];

/** Groups of lists that are off by default and have engines of their own. */
export const extraListGroups = ['cookies', 'annoyances'] as const;

/** A group of lists that the user can turn on in addition to the default ones. */
export type ExtraListGroup = (typeof extraListGroups)[number];

const easyList = (id: string, name: string, file: string): FilterList => ({
  id,
  name,
  url: `${uAssetsCdn}${file}`,
  homepage: easyListHome,
  license: 'GPL-3.0 or CC-BY-SA-3.0',
});

/**
 * Lists that uBlock Origin offers in its categories for cookie notices and annoyances, off
 * by default (`assets/assets.json` of uBlock Origin 1.75): those of EasyList and of uBlock
 * Origin itself, from the same repositories as the default lists.
 */
export const extraLists: Readonly<Record<ExtraListGroup, readonly FilterList[]>> = {
  cookies: [
    easyList('easylist-cookies', 'EasyList – Cookie Notices', 'easylist-cookies.txt'),
    {
      id: 'ublock-cookies',
      name: 'uBlock filters – Cookie Notices',
      url: `${uAssets}annoyances-cookies.txt`,
      homepage: ublockHome,
      license: 'GPL-3.0',
    },
  ],
  annoyances: [
    easyList('easylist-annoyances', 'EasyList – Other Annoyances', 'easylist-annoyances.txt'),
    easyList('easylist-chat', 'EasyList – Chat Widgets', 'easylist-chat.txt'),
    easyList('easylist-newsletters', 'EasyList – Newsletter Notices', 'easylist-newsletters.txt'),
    easyList('easylist-notifications', 'EasyList – Notifications', 'easylist-notifications.txt'),
    easyList('easylist-social', 'EasyList – Social Widgets', 'easylist-social.txt'),
    {
      id: 'ublock-annoyances',
      name: 'uBlock filters – Annoyances',
      url: `${uAssets}annoyances.txt`,
      homepage: ublockHome,
      license: 'GPL-3.0',
    },
  ],
};
