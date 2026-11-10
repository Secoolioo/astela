import { describe, expect, it } from 'vitest';
import { windowsProgram } from '../node/system-programs.ts';

describe('windowsProgram', () => {
  it('names a program of Windows by its full path in the system folder', () => {
    expect(windowsProgram('reg')).toMatch(/^[A-Za-z]:\\.+\\System32\\reg\.exe$/);
  });
});
