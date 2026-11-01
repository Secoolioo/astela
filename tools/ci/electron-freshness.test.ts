import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checkFreshness } from './electron-freshness.ts';

const published = ['44.9.3', '45.0.0', '45.1.0', '45.2.1', '46.0.0-alpha.4', '46.0.0-beta.1'];

describe('checkFreshness', () => {
  it('reports a newer patch release of the same major version', () => {
    const result = checkFreshness('45.0.0', published);
    assert.equal(result.latestPatch, '45.2.1');
    assert.equal(result.patchBehind, true);
    assert.equal(result.majorBehind, false);
  });

  it('ignores prereleases and is up to date on the newest patch', () => {
    const result = checkFreshness('45.2.1', published);
    assert.equal(result.patchBehind, false);
    assert.equal(result.majorBehind, false);
  });

  it('reports a newer major version separately', () => {
    const result = checkFreshness('45.2.1', [...published, '46.0.0', '46.0.1']);
    assert.equal(result.patchBehind, false);
    assert.equal(result.majorBehind, true);
    assert.equal(result.latest, '46.0.1');
  });

  it('rejects a version range', () => {
    assert.throws(() => checkFreshness('^45.0.0', published), /exact stable version/);
  });
});
