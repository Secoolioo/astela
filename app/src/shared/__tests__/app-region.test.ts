import { describe, expect, it } from 'vitest';
import { noAppRegionCss } from '../app-region.ts';

describe('noAppRegionCss', () => {
  const declarations =
    '{-webkit-app-region:initial!important;app-region:initial!important;window-drag:initial!important}';

  it('gives every element and pseudo-element of a page the initial app region', () => {
    const rules = noAppRegionCss.split('\n');
    for (const selector of ['*', '::before', '::after', '::backdrop', '::view-transition']) {
      expect(rules).toContain(`${selector}${declarations}`);
    }
  });

  it('puts each selector in a rule of its own', () => {
    // A selector that Chromium does not know drops its rule, and only its own.
    for (const rule of noAppRegionCss.split('\n')) {
      expect(rule.endsWith(declarations)).toBe(true);
      expect(rule.slice(0, -declarations.length)).not.toContain(',');
    }
  });
});
