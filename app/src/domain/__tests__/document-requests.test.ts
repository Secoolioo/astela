import { describe, expect, it } from 'vitest';
import { DocumentRequests, documentOf, type DocumentReader } from '../blocker/document-requests.ts';

/** A reader that names the same document every time it is read. */
const named =
  (document: string | null): DocumentReader =>
  () =>
    document;

/** A reader that names one document now and another one from the second read on. */
function changing(first: string, then: string | null): DocumentReader {
  let reads = 0;
  return () => {
    reads += 1;
    return reads === 1 ? first : then;
  };
}

/** Requests of nineteen documents that asked before any of them committed. */
function asked(): DocumentRequests {
  const requests = new DocumentRequests();
  requests.commit('1:1');
  for (let routing = 2; routing <= 20; routing += 1) requests.counts(named(`1:${String(routing)}`));
  return requests;
}

describe('DocumentRequests', () => {
  it('names a document by the process and the routing id of its main frame', () => {
    expect(documentOf({ processId: 8, routingId: 11 })).toBe('8:11');
  });

  it('counts the requests of the document on screen and of requests without a document', () => {
    const requests = new DocumentRequests();
    expect(requests.commit('8:1')).toBe(0);
    expect([requests.counts(named('8:1')), requests.counts(undefined)]).toEqual([true, true]);
  });

  it('counts no request of a frame that has left the frame tree', () => {
    const requests = new DocumentRequests();
    requests.commit('8:1');
    expect(requests.counts(named(null))).toBe(false);
    expect(requests.commit('8:8')).toBe(0);
  });

  it('counts the requests that a new document made before its commit for that document', () => {
    const requests = new DocumentRequests();
    requests.commit('8:1');
    // Requests that name the new document wait for it.
    expect(requests.counts(named('8:8'))).toBe(false);
    // Electron names the frame on screen for a request that comes just before the commit, and
    // the new document once it is read again.
    expect(requests.counts(changing('8:1', '8:8'))).toBe(true);
    expect(requests.commit('8:8')).toBe(2);
    expect(requests.counts(named('8:8'))).toBe(true);
  });

  it('counts the requests of a document that went for no page', () => {
    const requests = new DocumentRequests();
    requests.commit('8:1');
    // Beacons of the unload handlers of the page that goes, before and after the commit.
    expect(requests.counts(changing('8:1', null))).toBe(true);
    expect(requests.commit('10:4')).toBe(0);
    expect(requests.counts(named('8:1'))).toBe(false);
    expect(requests.commit('11:4')).toBe(0);
  });

  it('starts from 0 for a document that keeps the frame of the one before', () => {
    const requests = new DocumentRequests();
    requests.commit('8:1');
    expect(requests.counts(named('8:1'))).toBe(true);
    expect(requests.commit('8:1')).toBe(0);
  });

  it('counts the requests of a page that a script opened for the first page that commits there', () => {
    const requests = new DocumentRequests();
    requests.opened('8:1');
    expect(requests.counts(named('8:1'))).toBe(true);
    // The page that the script asked for keeps the frame of the first document.
    expect(requests.commit('8:1')).toBe(1);
    expect(requests.counts(named('8:1'))).toBe(true);
    expect(requests.commit('8:1')).toBe(0);
  });

  it('keeps the requests of the newest few documents only while none commits', () => {
    expect(asked().commit('1:2')).toBe(0);
    expect(asked().commit('1:20')).toBe(1);
  });

  it('reads again only the newest requests of the document on screen', () => {
    const requests = new DocumentRequests();
    requests.commit('8:1');
    for (let request = 0; request < 40; request += 1) requests.counts(changing('8:1', '8:8'));
    expect(requests.commit('8:8')).toBe(32);
  });
});
