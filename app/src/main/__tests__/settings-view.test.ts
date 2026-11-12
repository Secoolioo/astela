import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { defineSetting } from '../../domain/settings/setting.ts';
import type { SettingInspection } from '../../domain/settings/settings-service.ts';
import { settingView } from '../settings-page.ts';

const bar = defineSetting<boolean>({
  key: 'bookmarks.bar',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  ui: { section: 'appearance', control: 'toggle', order: 1 },
});

/** How a setting shows with a value of the user and maybe a recommendation. */
function view(userValue: boolean | undefined, recommendedValue?: boolean): unknown {
  const inspection: SettingInspection<unknown> = {
    key: bar.key,
    value: userValue ?? recommendedValue ?? false,
    source:
      userValue !== undefined
        ? 'user'
        : recommendedValue === undefined
          ? 'default'
          : 'policy-recommended',
    locked: false,
    defaultValue: false,
    ...(recommendedValue === undefined ? {} : { recommendedValue }),
    ...(userValue === undefined ? {} : { userValue }),
  };
  return settingView(bar, inspection, new Map());
}

describe('settingView', () => {
  it('counts a value of the user as changed when it differs from the default', () => {
    expect(view(true)).toMatchObject({ changed: true, recommended: false });
    expect(view(false)).toMatchObject({ changed: false });
    expect(view(undefined)).toMatchObject({ changed: false });
  });

  it('counts any value of the user as changed while the organization recommends one', () => {
    // The user's value is the default here, but Reset brings the recommended one back.
    expect(view(false, true)).toMatchObject({ changed: true, recommended: false });
    expect(view(undefined, true)).toMatchObject({ changed: false, recommended: true });
  });
});
