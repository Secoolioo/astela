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
