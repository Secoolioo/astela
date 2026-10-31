import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { channelOf, parseChecksums, previousRelease, verifyChecksum } from './releases.ts';

const published = (...versions: string[]): { version: string; channel: 'stable' | 'beta' }[] =>
  versions.map((version) => ({ version, channel: channelOf(version) }));

describe('previousRelease', () => {
  it('finds none for the first release', () => {
    assert.equal(previousRelease([], '0.1.0-beta.1'), undefined);
    assert.equal(previousRelease(published('0.1.0-beta.1'), '0.1.0-beta.1'), undefined);
  });

  it('updates a beta from the newest earlier beta', () => {
    assert.equal(
      previousRelease(published('0.1.0-beta.1', '0.1.0-beta.2'), '0.1.0-beta.3'),
      '0.1.0-beta.2',
    );
  });

  it('never updates a beta from a stable release, whose installations stay on stable', () => {
    assert.equal(
      previousRelease(published('0.1.0-beta.2', '0.1.0', '0.1.1'), '0.2.0-beta.1'),
      '0.1.0-beta.2',
    );
    assert.equal(previousRelease(published('0.1.0', '0.1.1'), '0.2.0-beta.1'), undefined);
  });

  it('updates a stable release from the newest earlier stable release', () => {
    assert.equal(
      previousRelease(published('0.1.0', '0.1.1', '0.2.0-beta.1', '0.2.0-beta.2'), '0.2.0'),
      '0.1.1',
    );
  });

  it('reaches the first stable release from the newest beta', () => {
    assert.equal(
      previousRelease(published('0.1.0-beta.1', '0.1.0-beta.2'), '0.1.0'),
      '0.1.0-beta.2',
    );
  });

  it('ignores the new version itself, newer versions and the order of the list', () => {
    assert.equal(
      previousRelease(
        published('0.2.0-beta.1', '0.1.1', '0.1.0-beta.10', '0.1.0-beta.9', '0.1.0'),
        '0.1.1',
      ),
      '0.1.0',
    );
    assert.equal(
      previousRelease(published('0.1.0-beta.9', '0.1.0-beta.10'), '0.1.0-beta.11'),
      '0.1.0-beta.10',
    );
  });
});

describe('parseChecksums', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);

  it('reads the text and the binary mode of sha256sum', () => {
    const sums = parseChecksums(`${a}  astela-linux-x86_64.AppImage\n${b} *SHA256SUMS.sig\n`);
    assert.deepEqual(
      [...sums],
      [
        ['astela-linux-x86_64.AppImage', a],
        ['SHA256SUMS.sig', b],
      ],
    );
  });

  it('skips empty and malformed lines', () => {
    assert.equal(parseChecksums(`\n${a.slice(1)}  short\nnot a checksum\r\n${b}  ok\r\n`).size, 1);
  });
});

describe('verifyChecksum', () => {
  const bytes = Buffer.from('package');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  it('accepts a file with the listed SHA-256', () => {
    assert.doesNotThrow(() => verifyChecksum(new Map([['file', sha256]]), 'file', bytes));
  });

  it('rejects a changed or unlisted file', () => {
    assert.throws(
      () => verifyChecksum(new Map([['file', sha256]]), 'file', Buffer.from('changed')),
      /SHA-256/,
    );
    assert.throws(() => verifyChecksum(new Map(), 'file', bytes), /does not list file/);
  });
});
