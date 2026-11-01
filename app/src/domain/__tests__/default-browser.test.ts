import { describe, expect, it } from 'vitest';
import { userChoiceProgId } from '../default-browser/default-browser.ts';

describe('userChoiceProgId', () => {
  it('reads the program id of the https links from reg query', () => {
    expect(
      userChoiceProgId(
        '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    AstelaURL\r\n\r\n',
      ),
    ).toBe('AstelaURL');
    expect(userChoiceProgId('    ProgId    REG_SZ    MSEdgeHTM  \n')).toBe('MSEdgeHTM');
    expect(
      userChoiceProgId('ERROR: The system was unable to find the specified registry key.'),
    ).toBe(undefined);
  });
});
