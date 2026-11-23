import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { defineSetting } from '../../domain/settings/setting.ts';
import type { PolicyStatus } from '../../domain/policy/policy-service.ts';
import type { SettingInspection } from '../../domain/settings/settings-service.ts';
import { SettingView } from '../../shared/ipc/settings-contracts.ts';
import { ignoredPolicyOf, settingView } from '../settings-page.ts';

const bar = defineSetting<boolean>({
  key: 'bookmarks.bar',
  schema: v.boolean(),
  default: false,
  scope: 'global',
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

/** A policy value of the last read with its state. */
function status(
  state: PolicyStatus['state'],
  level: PolicyStatus['level'] = 'mandatory',
): PolicyStatus {
  return {
    name: 'BookmarkBarEnabled',
    value: state === 'applied' ? true : 'yes',
    level,
    scope: 'machine',
    source: `/etc/astela/policies/${level}/a.json`,
    state,
    ...(state === 'applied' ? {} : { message: `${state} ${level}` }),
  };
}

describe('ignoredPolicyOf', () => {
  it('tells which policy of the organization does not apply, and why', () => {
    expect(ignoredPolicyOf([status('invalid')], 'BookmarkBarEnabled')).toEqual({
      policy: 'BookmarkBarEnabled',
      state: 'invalid',
    });
    expect(
      ignoredPolicyOf([status('not-allowed-as-recommended', 'recommended')], 'BookmarkBarEnabled'),
    ).toEqual({ policy: 'BookmarkBarEnabled', state: 'not-allowed-as-recommended' });
    expect(ignoredPolicyOf([status('sensitive-requires-machine')], 'BookmarkBarEnabled')).toEqual({
      policy: 'BookmarkBarEnabled',
      state: 'sensitive-requires-machine',
    });
    expect(ignoredPolicyOf([status('invalid')], 'ShowHomeButton')).toBeUndefined();
    expect(ignoredPolicyOf([status('invalid')], undefined)).toBeUndefined();
    expect(ignoredPolicyOf([], 'BookmarkBarEnabled')).toBeUndefined();
  });

  it('says nothing when a value with more precedence applies', () => {
    const recommended = status('not-allowed-as-recommended', 'recommended');
    expect(ignoredPolicyOf([status('applied'), recommended], 'BookmarkBarEnabled')).toBeUndefined();
    expect(
      ignoredPolicyOf([status('applied'), status('overridden')], 'BookmarkBarEnabled'),
    ).toBeUndefined();
    // A mandatory value that does not apply counts, also when a recommended one applies.
    expect(
      ignoredPolicyOf([status('invalid'), status('applied', 'recommended')], 'BookmarkBarEnabled'),
    ).toEqual({ policy: 'BookmarkBarEnabled', state: 'invalid' });
  });

  it('passes the state on to the view of the setting, without the English reason', () => {
    const inspection: SettingInspection<unknown> = {
      key: bar.key,
      value: false,
      source: 'default',
      locked: false,
      defaultValue: false,
    };
    const ignored = ignoredPolicyOf([status('invalid')], 'BookmarkBarEnabled');
    const shown = settingView(bar, inspection, new Map(), ignored);
    expect(shown).toMatchObject({
      locked: false,
      policyIgnored: { policy: 'BookmarkBarEnabled', state: 'invalid' },
    });
    // The page words the state in its language; the reason of the check stays in the log.
    expect(JSON.stringify(shown)).not.toContain('invalid mandatory');
    expect(v.safeParse(SettingView, shown).success).toBe(true);
    expect(settingView(bar, inspection, new Map())).not.toHaveProperty('policyIgnored');
  });
});
