import { newTabUrl } from '../../shared/internal-pages.ts';
import type { CommandPalette, PaletteItem } from '../../shared/ipc/overlay-contracts.ts';
import { matchesAll, matchRank, searchWords } from '../../shared/search-text.ts';
import type { WindowCommand } from '../../shared/shortcuts.ts';
import { isMessageKey, type MessageKey } from '../i18n/i18n.ts';
import {
  commandNameKey,
  settingsIndex,
  textOf,
  type SettingsRow,
} from '../ui-kit/settings-index.ts';

/**
 * What the palette searches: everything, or only the commands, the open tabs, the bookmarks,
 * the history or the settings, which a prefix or tab search chooses.
 */
export type PaletteScope = 'all' | 'commands' | 'tabs' | 'bookmarks' | 'history' | 'settings';

/** The scopes that the browser process answers for, with the tabs, bookmarks and history. */
export type RemoteScope = 'all' | 'tabs' | 'bookmarks' | 'history';

/** The prefixes that narrow the search to a scope, each followed by a space. */
export const prefixes: Readonly<Record<string, Exclude<PaletteScope, 'all'>>> = {
  '>': 'commands',
  '%': 'tabs',
  '*': 'bookmarks',
  '^': 'history',
  '#': 'settings',
};

/** How many results of the page's own kinds show with everything and text. */
export const localLimits = { commands: 6, settings: 3, settingsScope: 50 } as const;

/** What the palette shows of the browser process's answer. */
export interface PaletteAnswer {
  /** The number of the answer, which a choice names. */
  readonly answer: number;
  readonly items: readonly PaletteItem[];
}

/** A row of the palette, with the key that marks it across updates. */
export type PaletteRow =
  | {
      readonly kind: 'command';
      readonly key: string;
      readonly id: WindowCommand;
      readonly label: string;
      /** The first shortcut of the command, in the notation of the tables, if it has one. */
      readonly shortcut: string | undefined;
    }
  | {
      readonly kind: 'setting';
      readonly key: string;
      readonly id: string;
      readonly label: string;
      /** The name of the section of the settings page that the row is in. */
      readonly section: string;
    }
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly item: PaletteItem;
      /** The answer and the place in it, which a choice names. */
      readonly answer: number;
      readonly index: number;
    };

/** The groups of the palette, in the order in which they show. */
export const groupOrder = [
  'recent',
  'commands',
  'tabs',
  'thisWindow',
  'otherWindows',
  'settings',
  'bookmarks',
  'history',
  'web',
] as const;

/** A group of the palette. */
export type GroupId = (typeof groupOrder)[number];

/** A group of rows under a heading. */
export interface PaletteGroup {
  readonly id: GroupId;
  readonly rows: readonly PaletteRow[];
}

/** What the palette's page needs of its content to make its own rows. */
export type LocalContent = Pick<CommandPalette, 'commands' | 'recent' | 'vertical' | 'absent'>;

/**
 * The name of an open tab as the tab strip shows it: its title, else its address, and a new tab
 * for a blank page or a new tab page that has no title yet.
 * @param tab - Its title and its address.
 * @param untitled - The name of a new tab in the language of the page.
 */
export function tabLabel(
  tab: { readonly title: string; readonly url: string },
  untitled: string,
): string {
  if (tab.title !== '') return tab.title;
  return tab.url === '' || tab.url === 'about:blank' || tab.url === newTabUrl ? untitled : tab.url;
}

/**
 * The scope and the text of what was typed: a prefix of a scope followed by a space, such as
 * `> zoom`, narrows the search, and the rest is the text. `^` is a dead key on German
 * layouts; its space types it, and the next space follows it.
 * @param value - What the field holds.
 * @returns The scope of the prefix, or `undefined` without one, and the text after it.
 */
export function parseQuery(value: string): {
  readonly scope: Exclude<PaletteScope, 'all'> | undefined;
  readonly text: string;
} {
  const match = /^([>%*^#]) (.*)$/su.exec(value);
  const scope = match === null ? undefined : prefixes[match[1] ?? ''];
  return scope === undefined
    ? { scope: undefined, text: value }
    : { scope, text: match?.[2] ?? '' };
}

/**
 * What the palette asks the browser process for in a scope, or `undefined` when the page
 * finds everything itself: the commands, the settings, and everything without text.
 * @param scope - The scope.
 * @param text - The text.
 */
export function remoteScope(scope: PaletteScope, text: string): RemoteScope | undefined {
  if (scope === 'commands' || scope === 'settings') return undefined;
  if (scope === 'all' && searchWords(text).length === 0) return undefined;
  return scope;
}

/** The searchable texts of the commands and the settings, folded once per page. */
const texts = new Map<string, string>();

/** The texts of keys in every shipped language, folded, made once. */
function cachedText(id: string, keys: readonly MessageKey[], words?: readonly string[]): string {
  let text = texts.get(id);
  if (text === undefined) {
    text = textOf(keys, words);
    texts.set(id, text);
  }
  return text;
}

/** The keys of the names of a command, wherever the tab strip is, and of its keywords. */
function commandKeys(command: WindowCommand): MessageKey[] {
  const keywords = `palette.keywords.${command}`;
  return [
    ...new Set([commandNameKey(command, false), commandNameKey(command, true)]),
    ...(isMessageKey(keywords) ? [keywords] : []),
  ];
}

/**
 * How well a name matches: the name in the page's language first, then the texts in every
 * language, as the settings page finds its rows; `undefined` when a word is missing.
 */
function rankOf(label: string, all: string, words: readonly string[]): number | undefined {
  const own = matchRank(label, words);
  const any = matchRank(all, words);
  if (own === undefined && any === undefined) return undefined;
  return Math.min(own ?? 3, any ?? 3);
}

/** The items whose rank is defined, the best first, ties in the order of the list. */
function best<T>(list: readonly { item: T; rank: number | undefined }[]): T[] {
  return list
    .filter((entry): entry is { item: T; rank: number } => entry.rank !== undefined)
    .toSorted((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

/**
 * Whether the palette offers a row of the settings page: not the rows of the shortcuts, which
 * their commands stand for, not a row that the value of another setting shows, and not one
 * whose setting the browser does not offer on this system.
 */
function offered(row: SettingsRow, absent: readonly string[]): boolean {
  if (row.id.startsWith('shortcut-')) return false;
  if (row.when !== undefined) return false;
  return row.onlyWhereOffered !== true || !absent.includes(row.id);
}

/**
 * The rows that the palette's page finds itself, in groups: the commands that the palette ran
 * last and every command that can run now while nothing is typed, and the commands and the
 * settings that match the text. Every word must be in the name of a command or its keywords,
 * or in the texts of a setting, in any shipped language; a matching name of a section of the
 * settings lists its rows. The best matches come first, ties in the order of the catalog.
 * @param text - What was typed, without the prefix of a scope.
 * @param scope - What the palette searches.
 * @param content - The commands that can run, with their shortcuts, and what the palette ran
 *   last.
 * @param t - Translates into the page's language.
 */
export function localGroups(
  text: string,
  scope: PaletteScope,
  content: LocalContent,
  t: (key: MessageKey, params?: Readonly<Record<string, string>>) => string,
): PaletteGroup[] {
  const words = searchWords(text);
  const groups: PaletteGroup[] = [];
  const commandRow = (
    id: WindowCommand,
    shortcuts: readonly string[],
    group: GroupId,
  ): Extract<PaletteRow, { kind: 'command' }> => ({
    kind: 'command',
    key: `${group}:${id}`,
    id,
    label: t(commandNameKey(id, content.vertical)),
    shortcut: shortcuts[0],
  });
  if (scope === 'all' || scope === 'commands') {
    if (words.length === 0) {
      if (scope === 'all') {
        const recent = content.recent.flatMap((id) => {
          const command = content.commands.find((candidate) => candidate.id === id);
          return command === undefined ? [] : [commandRow(id, command.shortcuts, 'recent')];
        });
        groups.push({ id: 'recent', rows: recent.slice(0, 5) });
      }
      groups.push({
        id: 'commands',
        rows: content.commands.map(({ id, shortcuts }) => commandRow(id, shortcuts, 'commands')),
      });
    } else {
      const found = best(
        content.commands.map(({ id, shortcuts }) => {
          const row = commandRow(id, shortcuts, 'commands');
          const all = cachedText(`command:${id}`, commandKeys(id));
          return { item: row, rank: rankOf(row.label, all, words) };
        }),
      );
      groups.push({
        id: 'commands',
        rows: scope === 'all' ? found.slice(0, localLimits.commands) : found,
      });
    }
  }
  if ((scope === 'all' && words.length > 0) || scope === 'settings') {
    const rows: { item: PaletteRow; rank: number | undefined }[] = [];
    for (const section of settingsIndex) {
      const sectionText = cachedText(`section:${section.id}`, [section.title]);
      const named = words.length > 0 && matchesAll(sectionText, words);
      for (const row of section.rows) {
        if (!offered(row, content.absent)) continue;
        const [first] = row.keys;
        if (first === undefined) continue;
        const label = t(first);
        const item: PaletteRow = {
          kind: 'setting',
          key: `settings:${row.id}`,
          id: row.id,
          label,
          section: t(section.title),
        };
        const rank =
          words.length === 0
            ? 0
            : (rankOf(label, cachedText(`row:${row.id}`, row.keys, row.words), words) ??
              (named ? 2 : undefined));
        rows.push({ item, rank });
      }
    }
    const limit = scope === 'all' ? localLimits.settings : localLimits.settingsScope;
    groups.push({ id: 'settings', rows: best(rows).slice(0, limit) });
  }
  return groups;
}

/** The group of a result of the browser process in a scope. */
function groupOf(item: PaletteItem, scope: PaletteScope): GroupId {
  if (item.kind === 'tab') {
    if (scope !== 'tabs') return 'tabs';
    return item.place === 'other' ? 'otherWindows' : 'thisWindow';
  }
  if (item.kind === 'bookmark') return 'bookmarks';
  if (item.kind === 'history') return 'history';
  return 'web';
}

/** The key of a result, which stays the same in the next answer for the same page. */
function itemKey(item: PaletteItem): string {
  if (item.kind === 'search') return `search:${item.query}`;
  return `${item.kind}:${item.url}`;
}

/**
 * The groups of the palette in their order: the page's own rows and the results of the
 * browser process's answer, without groups that are empty. Rows of the same page in one
 * answer, such as two tabs that show it, get keys of their own.
 * @param local - The page's own groups, from {@link localGroups}.
 * @param answer - The answer of the browser process for the same text and scope, if any.
 * @param scope - What the palette searches.
 */
export function mergeGroups(
  local: readonly PaletteGroup[],
  answer: PaletteAnswer | undefined,
  scope: PaletteScope,
): PaletteGroup[] {
  const remote = new Map<GroupId, PaletteRow[]>();
  const seen = new Map<string, number>();
  for (const [index, item] of (answer?.items ?? []).entries()) {
    const base = itemKey(item);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const group = groupOf(item, scope);
    const rows = remote.get(group) ?? [];
    rows.push({
      kind: 'item',
      key: count === 0 ? base : `${base}#${String(count)}`,
      item,
      answer: answer?.answer ?? 0,
      index,
    });
    remote.set(group, rows);
  }
  return groupOrder
    .map((id) => ({
      id,
      rows: [...(local.find((group) => group.id === id)?.rows ?? []), ...(remote.get(id) ?? [])],
    }))
    .filter((group) => group.rows.length > 0);
}

/** How the keys move the marked row. */
export type SelectionMove = 'next' | 'previous' | 'pageDown' | 'pageUp';

/** How many rows Page Down and Page Up move. */
export const pageRows = 8;

/**
 * The row that a key marks: the arrows move by one and go round at the ends, Page Down and Page
 * Up move by {@link pageRows} and stop at the ends.
 * @param keys - The keys of the rows, in their order.
 * @param marked - The key of the marked row.
 * @param move - The key.
 * @returns The key of the row that is marked now, or `undefined` without rows.
 */
export function moveSelection(
  keys: readonly string[],
  marked: string | undefined,
  move: SelectionMove,
): string | undefined {
  if (keys.length === 0) return undefined;
  const at = marked === undefined ? -1 : keys.indexOf(marked);
  const from = at === -1 ? 0 : at;
  const count = keys.length;
  if (move === 'next') return keys[at === -1 ? 0 : (from + 1) % count];
  if (move === 'previous') return keys[at === -1 ? count - 1 : (from - 1 + count) % count];
  if (move === 'pageDown') return keys[Math.min(count - 1, from + pageRows)];
  return keys[Math.max(0, from - pageRows)];
}

/**
 * The row that stays marked after the rows changed, such as when an answer arrived: the row
 * that the keys marked, while it is still there, or else the first row, which the mark follows
 * until the keys move it.
 * @param keys - The keys of the rows, in their order.
 * @param marked - The key of the marked row.
 * @param moved - Whether the keys moved the mark since the text changed last.
 */
export function keptSelection(
  keys: readonly string[],
  marked: string | undefined,
  moved: boolean,
): string | undefined {
  if (moved && marked !== undefined && keys.includes(marked)) return marked;
  return keys[0];
}
