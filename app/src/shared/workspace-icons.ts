/**
 * The icons that people give a workspace, Lucide icons that the shell and the overlay draw: a
 * circle, a house, a briefcase, a person, people, code, a book, a graduation cap, a flask,
 * music, a film, a game controller, a shopping cart, an airplane, a heart and a star.
 */
export const workspaceIcons = [
  'circle',
  'home',
  'briefcase',
  'user',
  'users',
  'code',
  'book',
  'graduation',
  'flask',
  'music',
  'film',
  'gamepad',
  'cart',
  'plane',
  'heart',
  'star',
] as const;

/** An icon of a workspace. */
export type WorkspaceIcon = (typeof workspaceIcons)[number];
