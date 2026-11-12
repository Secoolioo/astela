import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  catchesUpLiveUpdate,
  channelOf,
  isLiveUpdateProof,
  liveUpdateProofName,
  mayCatchUpLiveUpdate,
  parseChecksums,
  previousRelease,
  verifyChecksum,
} from './releases.ts';

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

describe('mayCatchUpLiveUpdate', () => {
  const now = new Date('2026-11-12T06:00:00Z');

  it('catches up the proof of a version published in the last 14 days', () => {
    assert.equal(mayCatchUpLiveUpdate('2026-11-12T05:51:00Z', '0.1.0-beta.4', now), true);
    assert.equal(mayCatchUpLiveUpdate('2026-10-29T06:00:00Z', '0.1.0-beta.4', now), true);
  });

  it('leaves out an older release, a version that is not published and the first release', () => {
    assert.equal(mayCatchUpLiveUpdate('2026-10-29T05:59:59Z', '0.1.0-beta.4', now), false);
    assert.equal(mayCatchUpLiveUpdate(undefined, '0.1.0-beta.4', now), false);
    assert.equal(mayCatchUpLiveUpdate('2026-11-12T05:51:00Z', undefined, now), false);
  });

  it('leaves out a publication time after the current time', () => {
    assert.equal(mayCatchUpLiveUpdate('2026-11-12T07:00:00Z', '0.1.0-beta.4', now), false);
  });

  it('names the artifact of the proof after the version', () => {
    assert.equal(liveUpdateProofName('0.1.0-beta.5'), 'live-update-v0.1.0-beta.5');
  });
});

describe('catchesUpLiveUpdate', () => {
  const now = new Date('2026-11-12T06:00:00Z');
  const onMain = { head_branch: 'main', head_repository_id: 7, repository_id: 7 };
  const proof = { expired: false, workflow_run: onMain };
  const plan = {
    release: false,
    publishedAt: '2026-11-12T05:51:00Z',
    previous: '0.1.0-beta.4',
    now,
    artifacts: [],
  };

  it('catches up a proof that no run on main passed', () => {
    assert.equal(catchesUpLiveUpdate(plan), true);
  });

  it('leaves a release run, which runs the proof anyway, and a version without a catch-up', () => {
    assert.equal(catchesUpLiveUpdate({ ...plan, release: true }), false);
    assert.equal(catchesUpLiveUpdate({ ...plan, publishedAt: undefined }), false);
    assert.equal(catchesUpLiveUpdate({ ...plan, previous: undefined }), false);
    assert.equal(catchesUpLiveUpdate({ ...plan, publishedAt: '2026-10-01T00:00:00Z' }), false);
  });

  it('stops once a run on main kept the record of a passed proof', () => {
    assert.equal(catchesUpLiveUpdate({ ...plan, artifacts: [proof] }), false);
  });

  it('counts no expired record and no record from another branch or a fork', () => {
    const others = [
      { ...proof, expired: true },
      { expired: false, workflow_run: { ...onMain, head_branch: 'feat/x' } },
      { expired: false, workflow_run: { ...onMain, head_repository_id: 8 } },
      { expired: false, workflow_run: null },
      { expired: false },
    ];
    for (const artifact of others) assert.equal(isLiveUpdateProof(artifact), false);
    assert.equal(catchesUpLiveUpdate({ ...plan, artifacts: others }), true);
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
