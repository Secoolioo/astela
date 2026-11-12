import { describe, expect, it } from 'vitest';
import { formatRatio } from '../color.ts';

describe('formatRatio', () => {
  it('writes a contrast ratio with one decimal as the language does', () => {
    expect(formatRatio(1, 'en')).toBe('1.0');
    expect(formatRatio(3.24, 'en')).toBe('3.2');
    // The German warning writes 4,5:1, so the measured ratio needs a comma as well.
    expect(formatRatio(3.24, 'de')).toBe('3,2');
    expect(formatRatio(12.96, 'de')).toBe('13,0');
  });
});
