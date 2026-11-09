import { describe, expect, it } from 'vitest';
import {
  answer,
  decide,
  forget,
  isGranted,
  maxSites,
  originOf,
  permissionsFor,
  type SitePermissions,
} from '../permissions/site-permissions.ts';

const meet = 'https://meet.example';

describe('permissionsFor', () => {
  it('grants full screen, pointer lock and writing to the clipboard without asking', () => {
    // Sharing the screen asks with its own picker instead.
    for (const permission of [
      'fullscreen',
      'pointerLock',
      'clipboard-sanitized-write',
      'display-capture',
    ]) {
      expect(permissionsFor(permission)).toBe('grant');
    }
  });

  it('asks for the camera and the microphone that a page wants', () => {
    expect(permissionsFor('media', ['video'])).toEqual(['camera']);
    expect(permissionsFor('media', ['audio'])).toEqual(['microphone']);
    expect(permissionsFor('media', ['video', 'audio'])).toEqual(['camera', 'microphone']);
    expect(permissionsFor('media', [])).toBe('refuse');
  });

  it('asks for the location, notifications and reading the clipboard', () => {
    expect(permissionsFor('geolocation')).toEqual(['location']);
    expect(permissionsFor('notifications')).toEqual(['notifications']);
    expect(permissionsFor('clipboard-read')).toEqual(['clipboard']);
  });

  it('refuses everything that has no prompt', () => {
    for (const permission of [
      'midi',
      'midiSysex',
      'openExternal',
      'local-network',
      'window-management',
      'idle-detection',
      'storage-access',
      'unknown',
    ]) {
      expect(permissionsFor(permission)).toBe('refuse');
    }
  });
});

describe('originOf', () => {
  it('keeps the scheme, host and port of web addresses only', () => {
    expect(originOf('https://meet.example/room?x=1')).toBe(meet);
    expect(originOf('http://127.0.0.1:8080/a')).toBe('http://127.0.0.1:8080');
    expect(originOf('HTTPS://Meet.Example:443/')).toBe(meet);
    expect(originOf('file:///tmp/a.html')).toBeUndefined();
    expect(originOf('data:text/html,x')).toBeUndefined();
    expect(originOf('app://settings/')).toBeUndefined();
    expect(originOf('https://')).toBeUndefined();
  });
});

describe('answer', () => {
  const sites: SitePermissions = {
    [meet]: { camera: 'allow', microphone: 'block' },
    'https://maps.example': { location: 'allow' },
  };

  it('gives what the site may use, refuses what it may not and asks about the rest', () => {
    expect(answer(sites, meet, ['camera'])).toEqual({ kind: 'allow' });
    expect(answer(sites, meet, ['camera', 'microphone'])).toEqual({ kind: 'block' });
    expect(answer(sites, 'https://maps.example', ['location', 'notifications'])).toEqual({
      kind: 'ask',
      permissions: ['notifications'],
    });
    expect(answer(sites, 'https://new.example', ['camera', 'microphone'])).toEqual({
      kind: 'ask',
      permissions: ['camera', 'microphone'],
    });
  });

  it('ignores names that every object has', () => {
    expect(answer(sites, 'constructor', ['camera'])).toEqual({
      kind: 'ask',
      permissions: ['camera'],
    });
  });
});

describe('isGranted', () => {
  const sites: SitePermissions = { [meet]: { camera: 'allow', notifications: 'block' } };

  it('reports what a site may use for the checks of the page', () => {
    expect(isGranted(sites, meet, 'media', 'video')).toBe(true);
    expect(isGranted(sites, meet, 'media', 'audio')).toBe(false);
    expect(isGranted(sites, meet, 'notifications')).toBe(false);
    expect(isGranted(sites, meet, 'fullscreen')).toBe(true);
    expect(isGranted(sites, meet, 'midi')).toBe(false);
    expect(isGranted(sites, 'https://new.example', 'geolocation')).toBe(false);
  });
});

describe('decide and forget', () => {
  it('records decisions per site and forgets them one by one', () => {
    let sites: SitePermissions = {};
    sites = decide(sites, meet, ['camera', 'microphone'], 'allow');
    sites = decide(sites, meet, ['microphone'], 'block');
    expect(sites).toEqual({ [meet]: { camera: 'allow', microphone: 'block' } });
    sites = forget(sites, meet, 'camera');
    expect(sites).toEqual({ [meet]: { microphone: 'block' } });
    sites = forget(sites, meet, 'microphone');
    expect(sites).toEqual({});
    expect(forget(sites, meet, 'camera')).toBe(sites);
  });

  it('records no further site when the list is full', () => {
    const full: SitePermissions = Object.fromEntries(
      Array.from({ length: maxSites }, (_, n) => [`https://s${n}.example`, { camera: 'allow' }]),
    );
    expect(decide(full, meet, ['camera'], 'allow')).toBe(full);
    expect(decide(full, 'https://s1.example', ['location'], 'block')['https://s1.example']).toEqual(
      {
        camera: 'allow',
        location: 'block',
      },
    );
  });
});

describe('originOf with every part of an address', () => {
  it('reads user names, addresses in brackets and ports with leading zeros', () => {
    expect(originOf('https://user:secret@meet.example/x')).toBe(meet);
    expect(originOf('http://[::1]:8080/')).toBe('http://[::1]:8080');
    expect(originOf('http://example.com:080/')).toBe('http://example.com');
    expect(originOf('https://example.com:8443')).toBe('https://example.com:8443');
    expect(originOf('https://example.com?q')).toBe('https://example.com');
  });
});
