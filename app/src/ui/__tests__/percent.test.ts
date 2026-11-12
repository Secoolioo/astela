import { describe, expect, it } from 'vitest';
import { percent } from '../ui-kit/percent.ts';

describe('percent', () => {
  it('writes a factor as a percentage in a language', () => {
    expect(percent(1.25, 'en')).toBe('125%');
    // German puts a space that does not break before the sign.
    expect(percent(1.1, 'de')).toBe('110 %');
    expect(percent(0.5, 'de').startsWith('50')).toBe(true);
  });
});
