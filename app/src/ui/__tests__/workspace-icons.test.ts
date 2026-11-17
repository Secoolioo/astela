import { describe, expect, it } from 'vitest';
import { workspaceIcons } from '../../shared/workspace-icons.ts';
import { workspaceIconSvg } from '../ui-kit/workspace-icons.ts';

describe('the icons of the workspaces', () => {
  it('draws every icon that a workspace can have, hidden from screen readers', () => {
    expect(Object.keys(workspaceIconSvg)).toEqual([...workspaceIcons]);
    for (const icon of workspaceIcons) {
      const markup = workspaceIconSvg[icon].strings.join('');
      expect(markup).toMatch(/^<svg viewBox="0 0 24 24" aria-hidden="true">/);
      expect(markup).toMatch(/<(?:path|circle|rect)\s/);
      expect(markup.trimEnd()).toMatch(/<\/svg>$/);
    }
  });
});
