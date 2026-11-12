import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { checkTokens, problemsIn } from './check-tokens.ts';

describe('problemsIn', () => {
  it('finds durations and easings that are written out', () => {
    const css = [
      '.tab { transition: transform 180ms ease; }',
      '.menu { animation: open .2s cubic-bezier(0.2, 0, 0, 1); }',
      'el.animate(frames, { duration: 300 });',
    ].join('\n');
    assert.deepEqual(
      problemsIn('a.css', css).map(({ line, rule }) => [line, rule]),
      [
        [1, 'duration'],
        [1, 'easing'],
        [2, 'duration'],
        [2, 'easing'],
      ],
    );
  });

  it('accepts durations, easings and shadows from tokens, and rings', () => {
    const css = [
      '.tab { transition: transform var(--motion-base) var(--ease-standard); }',
      '.menu { box-shadow: var(--shadow-popover); }',
      '.field:focus { box-shadow: 0 0 0 1px var(--focus-ring); }',
      '.option { box-shadow: inset 0 0 0 1px var(--accent); }',
      'const tabs = 3; // 12 tabs',
    ].join('\n');
    assert.deepEqual(problemsIn('a.css', css), []);
  });

  it('finds shadows of their own', () => {
    assert.deepEqual(
      problemsIn('a.css', '.card { box-shadow: 0 4px 12px rgb(0 0 0 / 20%); }').map((p) => p.rule),
      ['shadow'],
    );
  });
});

describe('checkTokens', () => {
  it('finds nothing in the interface of the browser', () => {
    assert.deepEqual(checkTokens(resolve(import.meta.dirname, '../..')), []);
  });
});
