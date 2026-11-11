import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { labelOf, treeOf, type ProcessInfo } from './system.ts';

const processes = (list: readonly ProcessInfo[]): Map<number, ProcessInfo> =>
  new Map(list.map((info) => [info.pid, info]));

describe('treeOf', () => {
  it('takes a process with its children and their children', () => {
    const all = processes([
      { pid: 100, ppid: 1, cpuMs: 10, startedMs: 1000 },
      { pid: 200, ppid: 100, cpuMs: 20, startedMs: 1001 },
      { pid: 300, ppid: 200, cpuMs: 30, startedMs: 1002 },
      { pid: 400, ppid: 1, cpuMs: 40, startedMs: 999 },
    ]);
    assert.deepEqual(
      treeOf(all, 100).map((info) => info.pid),
      [100, 200, 300],
    );
  });

  it('leaves out a process that names the root as its parent but started before it', () => {
    // Windows gave the id of an ended parent to the root; its old child still names that id.
    const all = processes([
      { pid: 100, ppid: 1, cpuMs: 10, startedMs: 5000 },
      { pid: 200, ppid: 100, cpuMs: 20, startedMs: 5001 },
      { pid: 500, ppid: 100, cpuMs: 900, startedMs: 4000 },
    ]);
    assert.deepEqual(
      treeOf(all, 100).map((info) => info.pid),
      [100, 200],
    );
  });

  it('follows the parent ids alone where the platform reports no start', () => {
    const all = processes([
      { pid: 100, ppid: 1, cpuMs: 10 },
      { pid: 200, ppid: 100, cpuMs: 20 },
    ]);
    assert.deepEqual(
      treeOf(all, 100).map((info) => info.pid),
      [100, 200],
    );
  });
});

describe('labelOf', () => {
  it('names a process by its type', () => {
    assert.equal(labelOf('astela --type=renderer --lang=en-US'), 'renderer');
    assert.equal(
      labelOf('astela --type=utility --utility-sub-type=network.mojom.NetworkService'),
      'utility:network.mojom.NetworkService',
    );
    assert.equal(labelOf('astela --no-first-run'), 'main');
  });
});
