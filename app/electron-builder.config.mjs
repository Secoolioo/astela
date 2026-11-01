// Packaging configuration for every format and architecture. Product names come from
// brand.json; see docs/architecture/updates.md for the format strategy.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const brand = JSON.parse(readFileSync(new URL('../brand.json', import.meta.url), 'utf8'));
const { slug, productName, appId } = brand;

// fpm expands NAME, VERSION and ARCH in output paths, so packages are built outside the
// checkout unless a directory is given.
const output =
  process.env.PACKAGE_DIR ?? join(process.env.RUNNER_TEMP ?? tmpdir(), `${slug}-packages`);
// End-to-end tests drive the app through the inspector, which needs this one fuse. Shipped
// packages always have it off.
const e2e = process.env.E2E_BUILD === '1';

// The deb and rpm scripts carry the product names and the repository URL; electron-builder
// fills in its own macros afterwards.
const scripts = mkdtempSync(join(tmpdir(), `${slug}-scripts-`));
const linuxScript = (name) => {
  const text = readFileSync(new URL(`build/linux/${name}.tpl`, import.meta.url), 'utf8')
    .replaceAll('@SLUG@', slug)
    .replaceAll('@PRODUCT@', productName)
    .replaceAll('@WEBSITE@', brand.website)
    .replaceAll('@ENV@', slug.toUpperCase().replaceAll('-', '_'));
  const path = join(scripts, `${name}.tpl`);
  writeFileSync(path, text);
  return path;
};
const packageScripts = {
  afterInstall: linuxScript('after-install'),
  afterRemove: linuxScript('after-remove'),
};
// The public key of the package repositories, once the repository owner has created it.
const repoKey = new URL('build/keys/linux-repo.pub.asc', import.meta.url);
// The data of the content blocker, built by tools/blocker/build.ts before packaging. Without
// it, the package works and blocks nothing.
const blockerData = new URL('build/blocker/engine.bin', import.meta.url);

/** @type {import('electron-builder').Configuration} */
export default {
  appId,
  productName,
  executableName: slug,
  copyright: `Copyright © ${new Date().getUTCFullYear()} the ${productName} maintainers`,
  directories: { output, buildResources: 'build' },
  files: ['out/**', 'package.json'],
  extraMetadata: {
    name: slug,
    productName,
    description: brand.tagline,
    homepage: brand.website,
    author: { name: `${productName} maintainers` },
    desktopName: `${slug}.desktop`,
    main: 'out/main/index.js',
  },
  asar: true,
  extraResources: existsSync(blockerData) ? [{ from: 'build/blocker', to: 'blocker' }] : [],
  // The deb and rpm install scripts register the update channel of the package: beta for a
  // prerelease, which also receives stable releases. They read it from this file, because rpm
  // cannot query its database while it installs. The version is the one this build uses,
  // including an override on the command line.
  afterPack: (context) => {
    if (context.electronPlatformName !== 'linux') return;
    const channel = context.packager.appInfo.version.includes('-') ? 'beta' : 'stable';
    writeFileSync(join(context.appOutDir, 'resources', 'package-channel'), `${channel}\n`);
  },
  electronLanguages: ['en-US', 'de'],
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: e2e,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  // electron-updater needs a publish configuration; the signed feed provider replaces it.
  publish: [{ provider: 'generic', url: `${brand.website}updates/` }],
  // Targets carry no architectures: each CI job passes its own (`--x64`, `--arm64`), which
  // the command line cannot narrow once the configuration lists them. MSI is built for x64
  // only, because electron-builder marks an arm64 MSI as x64.
  win: { target: ['nsis', 'msi'] },
  nsis: {
    artifactName: `${slug}-windows-\${arch}-setup.\${ext}`,
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    // Checks for a running browser without PowerShell; see the file.
    include: 'build/installer.nsh',
  },
  msi: {
    artifactName: `${slug}-windows-\${arch}.\${ext}`,
    perMachine: true,
    // Fixed forever: Windows Installer uses it to find and upgrade earlier installations.
    upgradeCode: '6C36878C-6357-49A8-8D4F-8ADCE0E485FF',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: false,
    artifactName: `${slug}-macos-\${arch}.\${ext}`,
    // Lets macOS offer the browser for web links; links arrive as `open-url` events.
    protocols: [{ name: 'Web page', schemes: ['http', 'https'], role: 'Viewer' }],
    extendInfo: {
      NSCameraUsageDescription: 'A website you visit can ask to use the camera.',
      NSMicrophoneUsageDescription: 'A website you visit can ask to use the microphone.',
    },
  },
  dmg: { artifactName: `${slug}-macos-\${arch}.\${ext}` },
  linux: {
    target: ['AppImage', 'deb', 'rpm'],
    category: 'Network;WebBrowser',
    maintainer: `${productName} maintainers`,
    synopsis: brand.tagline,
    description: brand.tagline,
    executableArgs: [],
    syncDesktopName: true,
    extraResources: existsSync(repoKey)
      ? [{ from: 'build/keys/linux-repo.pub.asc', to: 'linux-repo.asc' }]
      : [],
    artifactName: `${slug}-linux-\${arch}.\${ext}`,
    desktop: {
      entry: {
        StartupWMClass: slug,
        MimeType: 'text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;',
      },
    },
  },
  deb: { packageCategory: 'web', priority: 'optional', ...packageScripts },
  rpm: {
    packageCategory: 'Applications/Internet',
    ...packageScripts,
    // Repairs what the removal script of an older version took away on an upgrade; see the file.
    fpm: ['--rpm-posttrans', linuxScript('rpm-posttrans')],
  },
};
