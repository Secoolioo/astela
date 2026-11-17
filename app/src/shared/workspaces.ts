import * as v from 'valibot';
import { swatches } from './swatches.ts';
import { workspaceIcons } from './workspace-icons.ts';

/** The id of the workspace that every profile has, which is never deleted or isolated. */
export const defaultWorkspaceId = 'default';

/** The most workspaces that a profile has. */
export const workspaceLimit = 20;

/** The longest name of a workspace. */
export const workspaceNameLimit = 40;

/** The id of a workspace: `default`, or `w` and up to 15 digits and letters of base 36. */
export const WorkspaceId = v.pipe(v.string(), v.regex(/^(?:default|w[0-9a-z]{1,15})$/));

/**
 * A workspace of the profile: its id, its name, which only the default workspace may leave
 * empty until it is renamed, its icon, its color and whether its pages keep their cookies, site
 * data and sign-ins in a partition of their own (`isolated`), which is chosen when it is made.
 */
export const Workspace = v.strictObject({
  id: WorkspaceId,
  name: v.pipe(v.string(), v.maxLength(workspaceNameLimit)),
  icon: v.picklist(workspaceIcons),
  color: v.picklist(swatches),
  isolated: v.boolean(),
});

/** A workspace of the profile. */
export type Workspace = v.InferOutput<typeof Workspace>;

/**
 * The workspaces of the profile in their order: 1 to 20 of them with ids of their own, among them
 * the default workspace, which is never isolated; every other one has a name.
 */
export const WorkspaceList = v.pipe(
  v.array(Workspace),
  v.minLength(1),
  v.maxLength(workspaceLimit),
  v.check(
    (list) =>
      new Set(list.map(({ id }) => id)).size === list.length &&
      list.some(({ id, isolated }) => id === defaultWorkspaceId && !isolated) &&
      list.every(({ id, name }) => id === defaultWorkspaceId || name.trim() !== ''),
    'Must name each workspace once, with the default workspace, which is not isolated',
  ),
);

/** The workspaces of a new profile: the default workspace alone. */
export const defaultWorkspaces: readonly Workspace[] = [
  { id: defaultWorkspaceId, name: '', icon: 'home', color: 'blue', isolated: false },
];

/**
 * The partition of the web pages of a workspace: `persist:ws-<id>` for a workspace of the list
 * that keeps its cookies, site data and sign-ins apart, or else the shared partition.
 * @param list - The workspaces of the profile.
 * @param id - The workspace, or `undefined` for none.
 * @param shared - The partition of the web pages of every other workspace.
 */
export function workspacePartition(
  list: readonly Workspace[],
  id: string | undefined,
  shared: string,
): string {
  return list.some((workspace) => workspace.id === id && workspace.isolated)
    ? `persist:ws-${id ?? ''}`
    : shared;
}
