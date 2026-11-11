import { BaseWindow, app, dialog, type WebContents } from 'electron';
import { uiLocale } from './ui-language.ts';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import * as v from 'valibot';
import { brand } from '../shared/brand.ts';
import { CustomTheme, paletteTokens } from '../shared/themes.ts';
import { writeFileAtomic } from '../platform/node/atomic-file.ts';
import { translatorFor } from './i18n/i18n.ts';

/** The version of the format of settings files; a later format gets a new number. */
const fileVersion = 1;

/** The largest settings file that the browser reads: lists of sites can be long. */
const largestFile = 16 * 1024 * 1024;

/** The window of a page, for its dialogs. */
function windowOf(contents: WebContents): BaseWindow | undefined {
  return BaseWindow.getAllWindows().find((window) =>
    window.contentView.children.some(
      (view) => 'webContents' in view && view.webContents === contents,
    ),
  );
}

/** The options of the file dialogs of settings files. */
function fileOptions(title: string): Electron.SaveDialogOptions & Electron.OpenDialogOptions {
  const i18n = translatorFor(uiLocale(), process.platform);
  return {
    title,
    defaultPath: join(app.getPath('documents'), `${brand.slug}-settings.json`),
    filters: [{ name: i18n.t('settings.fileType'), extensions: ['json'] }],
  };
}

/**
 * Saves the settings that the user changed, in a file that the user picks.
 * @param sender - The settings page.
 * @param definitions - The settings that the page shows.
 * @param settings - The settings.
 * @returns Whether the file was saved.
 */
export async function exportSettings(
  sender: WebContents,
  definitions: readonly SettingDefinition<unknown>[],
  settings: SettingsService,
): Promise<boolean> {
  const i18n = translatorFor(uiLocale(), process.platform);
  const options = fileOptions(i18n.t('settings.exportTitle'));
  const window = windowOf(sender);
  const { canceled, filePath } =
    window === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options);
  if (canceled || filePath === undefined || filePath === '') return false;
  const values: Record<string, unknown> = {};
  for (const definition of definitions) {
    const { userValue } = settings.inspect(definition);
    if (userValue !== undefined) values[definition.key] = userValue;
  }
  const file = { $schemaVersion: fileVersion, settings: values };
  await writeFileAtomic(filePath, `${JSON.stringify(file, null, 2)}\n`);
  return true;
}

/**
 * Reads settings from a file that the user picks. Settings that a policy fixes, that the page
 * does not show or whose value is not valid are skipped; nothing else changes.
 * @param sender - The settings page.
 * @param shown - The settings that the page shows, by key.
 * @param settings - The settings.
 */
export async function importSettings(
  sender: WebContents,
  shown: ReadonlyMap<string, SettingDefinition<unknown>>,
  settings: SettingsService,
): Promise<
  | { readonly ok: true; readonly applied: number; readonly skipped: number }
  | { readonly ok: false; readonly error: 'canceled' | 'invalid' }
> {
  const i18n = translatorFor(uiLocale(), process.platform);
  const options = {
    ...fileOptions(i18n.t('settings.importTitle')),
    properties: ['openFile' as const],
  };
  const window = windowOf(sender);
  const { canceled, filePaths } =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  const path = filePaths[0];
  if (canceled || path === undefined) return { ok: false, error: 'canceled' };
  let parsed: unknown;
  try {
    if ((await stat(path)).size > largestFile) return { ok: false, error: 'invalid' };
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const values: unknown =
    typeof parsed === 'object' &&
    parsed !== null &&
    Reflect.get(parsed, '$schemaVersion') === fileVersion
      ? Reflect.get(parsed, 'settings')
      : undefined;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return { ok: false, error: 'invalid' };
  }
  let applied = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(values)) {
    const definition = shown.get(key);
    // A folder of another computer has no place here; only the system's dialog sets one.
    if (definition?.ui?.control !== 'folder' && definition !== undefined) {
      if (settings.set(definition, value).ok) applied += 1;
      else skipped += 1;
    } else {
      skipped += 1;
    }
  }
  return { ok: true, applied, skipped };
}

/**
 * Asks for a folder in the system's dialog, in the window of the page that asked.
 * @param sender - The page that asked.
 * @param start - The folder that the dialog shows first.
 * @returns The chosen folder, or `undefined` when the dialog was cancelled.
 */
export async function chooseFolder(
  sender: WebContents,
  start: string,
): Promise<string | undefined> {
  const options = {
    defaultPath: start,
    properties: ['openDirectory' as const, 'createDirectory' as const],
  };
  const window = windowOf(sender);
  const { canceled, filePaths } =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  return canceled ? undefined : filePaths[0];
}

/** The version of the format of theme files. */
const themeFileVersion = 1;

/** The options of the file dialogs of theme files. */
function themeFileOptions(title: string): Electron.SaveDialogOptions & Electron.OpenDialogOptions {
  const i18n = translatorFor(uiLocale(), process.platform);
  return {
    title,
    defaultPath: join(app.getPath('documents'), `${brand.slug}-theme.json`),
    filters: [{ name: i18n.t('settings.themeFileType'), extensions: ['json'] }],
  };
}

/**
 * Saves the colors of the custom theme in a file that the user picks. The file lists the
 * colors in a fixed order, so saving a theme that was read from a file gives the same file.
 * @param sender - The settings page.
 * @param theme - The colors of the custom theme.
 * @returns Whether the file was saved.
 */
export async function exportTheme(sender: WebContents, theme: CustomTheme): Promise<boolean> {
  const i18n = translatorFor(uiLocale(), process.platform);
  const options = themeFileOptions(i18n.t('settings.themeExportTitle'));
  const window = windowOf(sender);
  const { canceled, filePath } =
    window === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options);
  if (canceled || filePath === undefined || filePath === '') return false;
  const file = {
    $schemaVersion: themeFileVersion,
    light: orderedPalette(theme.light),
    dark: orderedPalette(theme.dark),
  };
  await writeFileAtomic(filePath, `${JSON.stringify(file, null, 2)}\n`);
  return true;
}

/**
 * Reads the colors of a theme from a file that the user picks.
 * @param sender - The settings page.
 * @returns The colors, or why there are none.
 */
export async function importTheme(
  sender: WebContents,
): Promise<
  | { readonly ok: true; readonly theme: CustomTheme }
  | { readonly ok: false; readonly error: 'canceled' | 'invalid' }
> {
  const i18n = translatorFor(uiLocale(), process.platform);
  const options = {
    ...themeFileOptions(i18n.t('settings.themeImportTitle')),
    properties: ['openFile' as const],
  };
  const window = windowOf(sender);
  const { canceled, filePaths } =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  const path = filePaths[0];
  if (canceled || path === undefined) return { ok: false, error: 'canceled' };
  let parsed: unknown;
  try {
    // A theme is a few colors; anything large is no theme.
    if ((await stat(path)).size > 64 * 1024) return { ok: false, error: 'invalid' };
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Reflect.get(parsed, '$schemaVersion') !== themeFileVersion
  ) {
    return { ok: false, error: 'invalid' };
  }
  const theme = v.safeParse(CustomTheme, {
    light: Reflect.get(parsed, 'light'),
    dark: Reflect.get(parsed, 'dark'),
  });
  return theme.success ? { ok: true, theme: theme.output } : { ok: false, error: 'invalid' };
}

/** The colors of a palette in the order of the tokens, in lower case, for a canonical file. */
function orderedPalette(palette: CustomTheme['light']): Record<string, string> {
  return Object.fromEntries(
    paletteTokens.flatMap((token) => {
      const value = palette[token];
      return value === undefined ? [] : [[token, value.toLowerCase()]];
    }),
  );
}

/** The largest image that the new tab page takes as its background. */
const largestImage = 10 * 1024 * 1024;

/** The extensions of the images that the new tab page takes, by what the file starts with. */
const imageKinds: readonly {
  readonly extension: string;
  readonly matches: (head: Buffer) => boolean;
}[] = [
  {
    extension: 'png',
    matches: (head) =>
      head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { extension: 'jpg', matches: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff },
  { extension: 'gif', matches: (head) => head.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    extension: 'webp',
    matches: (head) =>
      head.subarray(0, 4).toString('latin1') === 'RIFF' &&
      head.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    extension: 'avif',
    matches: (head) => head.subarray(4, 12).toString('latin1') === 'ftypavif',
  },
];

/**
 * Asks for an image in the system's dialog and copies it into the profile, under a name
 * from its content; the images that were there before go.
 * @param sender - The settings page.
 * @param folder - The folder of the image in the profile.
 * @returns The name of the copy; `undefined` when the user chose nothing; `invalid` for a
 *   file that is no image or is too large.
 */
export async function chooseNewTabImage(
  sender: WebContents,
  folder: string,
): Promise<{ readonly file: string } | 'invalid' | undefined> {
  const i18n = translatorFor(uiLocale(), process.platform);
  const options = {
    title: i18n.t('settings.newTabImageTitle'),
    defaultPath: app.getPath('pictures'),
    filters: [
      {
        name: i18n.t('settings.imageFileType'),
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'],
      },
    ],
    properties: ['openFile' as const],
  };
  const window = windowOf(sender);
  const { canceled, filePaths } =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  const path = filePaths[0];
  if (canceled || path === undefined) return undefined;
  let content: Buffer;
  try {
    if ((await stat(path)).size > largestImage) return 'invalid';
    content = await readFile(path);
  } catch {
    return 'invalid';
  }
  // The content decides the kind, not the name, so the page only ever loads an image.
  const kind = imageKinds.find((known) => known.matches(content.subarray(0, 16)));
  if (kind === undefined) return 'invalid';
  const name = `background-${createHash('sha256').update(content).digest('hex').slice(0, 16)}.${kind.extension}`;
  await mkdir(folder, { recursive: true });
  await writeFileAtomic(join(folder, name), content);
  for (const old of await readdir(folder)) {
    if (old !== name && old.startsWith('background-')) await rm(join(folder, old), { force: true });
  }
  return { file: name };
}
