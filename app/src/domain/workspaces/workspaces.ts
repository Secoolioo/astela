import type { Swatch } from '../../shared/swatches.ts';
import type { WorkspaceIcon } from '../../shared/workspace-icons.ts';
import {
  defaultWorkspaceId,
  workspaceLimit,
  workspaceNameLimit,
  workspacePartition,
  type Workspace,
} from '../../shared/workspaces.ts';

export { defaultWorkspaceId, type Workspace } from '../../shared/workspaces.ts';

/** The id of a workspace, such as `default` or `w5k2`. */
export type WorkspaceId = string;

/** What people choose for a workspace: its name, its icon and its color. */
export interface WorkspaceLook {
  readonly name: string;
  readonly icon: WorkspaceIcon;
  readonly color: Swatch;
}

/** The pattern of the id of a workspace that is not the default one. */
const madeId = /^w[0-9a-z]{1,15}$/;

/**
 * The name of a workspace as the browser keeps it: without spaces at its ends, at most
 * {@link workspaceNameLimit} characters.
 * @param name - The name that people typed.
 */
export function workspaceName(name: string): string {
  return name.trim().slice(0, workspaceNameLimit).trim();
}

/**
 * The id of a new workspace: `w` and a random number in base 36 that no workspace has.
 * @param taken - The ids that the workspaces have.
 * @param random - Gives numbers from 0 to below 1, such as `Math.random`.
 */
export function newWorkspaceId(taken: readonly string[], random: () => number): WorkspaceId {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `w${Math.floor(random() * 36 ** 8).toString(36)}`;
    if (!taken.includes(id)) return id;
  }
  // A source of numbers that keeps repeating itself still gives an id that is free.
  let number = taken.length + 1;
  while (taken.includes(`w${number.toString(36)}`)) number += 1;
  return `w${number.toString(36)}`;
}

/**
 * Adds a workspace at the end of the list.
 * @param list - The workspaces.
 * @param look - Its name, icon and color.
 * @param id - Its id, from {@link newWorkspaceId}.
 * @param isolated - Whether it keeps its cookies and sign-ins apart.
 * @returns The new list, or `undefined` when the list is full, the id is taken or the name
 *   is empty.
 */
export function addWorkspace(
  list: readonly Workspace[],
  look: WorkspaceLook,
  id: WorkspaceId,
  isolated: boolean,
): Workspace[] | undefined {
  const name = workspaceName(look.name);
  if (list.length >= workspaceLimit || name === '' || !madeId.test(id)) return undefined;
  if (list.some((workspace) => workspace.id === id)) return undefined;
  return [...list, { id, name, icon: look.icon, color: look.color, isolated }];
}

/**
 * Renames a workspace, or gives it another icon or color; whether it keeps its cookies and
 * sign-ins apart never changes. The default workspace may go back to its name of the browser
 * with an empty name.
 * @param list - The workspaces.
 * @param id - The workspace.
 * @param look - Its new name, icon and color.
 * @returns The new list, or `undefined` when there is no such workspace or the name of
 *   another workspace is empty.
 */
export function updateWorkspace(
  list: readonly Workspace[],
  id: WorkspaceId,
  look: WorkspaceLook,
): Workspace[] | undefined {
  const name = workspaceName(look.name);
  if (name === '' && id !== defaultWorkspaceId) return undefined;
  if (!list.some((workspace) => workspace.id === id)) return undefined;
  return list.map((workspace) =>
    workspace.id === id ? { ...workspace, name, icon: look.icon, color: look.color } : workspace,
  );
}

/**
 * Takes a workspace out of the list; the default workspace stays.
 * @param list - The workspaces.
 * @param id - The workspace.
 * @returns The new list, or `undefined` for the default workspace or one that is not there.
 */
export function removeWorkspace(
  list: readonly Workspace[],
  id: WorkspaceId,
): Workspace[] | undefined {
  if (id === defaultWorkspaceId || !list.some((workspace) => workspace.id === id)) {
    return undefined;
  }
  return list.filter((workspace) => workspace.id !== id);
}

/**
 * Moves a workspace to another place in the list.
 * @param list - The workspaces.
 * @param id - The workspace.
 * @param index - Its new place, clamped to the list.
 * @returns The new list, or `undefined` when there is no such workspace or it stays where it is.
 */
export function moveWorkspace(
  list: readonly Workspace[],
  id: WorkspaceId,
  index: number,
): Workspace[] | undefined {
  const from = list.findIndex((workspace) => workspace.id === id);
  const moving = list[from];
  const to = Math.max(0, Math.min(Math.trunc(index), list.length - 1));
  if (moving === undefined || from === to) return undefined;
  const rest = list.filter((workspace) => workspace.id !== id);
  return [...rest.slice(0, to), moving, ...rest.slice(to)];
}

/**
 * The workspace at a place of the list, as the shortcuts of the workspaces count them.
 * @param list - The workspaces.
 * @param place - The place, from 1.
 */
export function workspaceAt(list: readonly Workspace[], place: number): Workspace | undefined {
  return place >= 1 ? list[place - 1] : undefined;
}

/**
 * The workspace after or before one in the list, round from the end to the start.
 * @param list - The workspaces.
 * @param current - The workspace that shows.
 * @param direction - 1 for the next, -1 for the previous one.
 * @returns The workspace, or `undefined` when the list has no other one.
 */
export function stepWorkspace(
  list: readonly Workspace[],
  current: WorkspaceId,
  direction: -1 | 1,
): Workspace | undefined {
  if (list.length < 2) return undefined;
  const index = Math.max(
    0,
    list.findIndex((workspace) => workspace.id === current),
  );
  return list[(index + direction + list.length) % list.length];
}

/**
 * The partition whose cookies, site data and sign-ins a workspace's pages use: one of its own,
 * `persist:ws-<id>`, for a workspace that keeps them apart, or else the shared one.
 * @param workspace - The workspace, or `undefined` for one that the profile does not have.
 * @param shared - The partition of the other web pages.
 */
export function partitionOf(workspace: Workspace | undefined, shared: string): string {
  return workspace === undefined ? shared : workspacePartition([workspace], workspace.id, shared);
}

/**
 * The folder in `Partitions` of the profile that keeps the data of a workspace with a partition
 * of its own, which goes once the workspace is deleted.
 * @param id - The workspace.
 * @returns The name of the folder, or `undefined` for the default workspace or an id that no
 *   workspace can have, such as `../x`.
 */
export function partitionFolder(id: string): string | undefined {
  return madeId.test(id) ? `ws-${id}` : undefined;
}
