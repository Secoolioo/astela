import { describe, expect, it } from 'vitest';
import { shouldShowSetupGuide } from '../setup/setup-guide.ts';

describe('shouldShowSetupGuide', () => {
  it('opens once per profile unless a policy or the command line turns it off', () => {
    const fresh = { shown: false, policy: undefined, noFirstRun: false };
    expect(shouldShowSetupGuide(fresh)).toBe(true);
    expect(shouldShowSetupGuide({ ...fresh, policy: true })).toBe(true);
    expect(shouldShowSetupGuide({ ...fresh, shown: true })).toBe(false);
    expect(shouldShowSetupGuide({ ...fresh, policy: false })).toBe(false);
    expect(shouldShowSetupGuide({ ...fresh, noFirstRun: true })).toBe(false);
  });
});
