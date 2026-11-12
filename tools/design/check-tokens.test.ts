import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { checkTokens, problemsIn } from './check-tokens.ts';

/** The line and the rule of each problem in a text. */
function found(text: string): [number, string][] {
  return problemsIn('a.ts', text).map(({ line, rule }) => [line, rule]);
}

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
        [3, 'duration'],
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

  it('finds durations and easings on later lines than their property name', () => {
    const css = [
      '.tab {',
      '  transition:',
      '    background-color 120ms ease,',
      '    transform 180ms ease-out;',
      '  animation:',
      '    open 0.2s',
      '    linear;',
      '}',
    ].join('\n');
    assert.deepEqual(found(css), [
      [3, 'duration'],
      [3, 'easing'],
      [4, 'duration'],
      [4, 'easing'],
      [6, 'duration'],
      [7, 'easing'],
    ]);
    const problem = problemsIn('a.css', css)[0];
    assert.equal(problem?.text, 'background-color 120ms ease,');
  });

  it('finds durations, delays and easings in code', () => {
    const code = [
      'el.animate(frames, {',
      '  duration: 200,',
      "  easing: 'ease-out',",
      '});',
      'el.animate(frames, { duration: motionOf(el, "--motion-base"), delay: 50 });',
      "el.style.cssText = 'background: url(https://a.example/b.png); transition: opacity .5s';",
      'html`<p style="transition: ${name} 120ms ease-in"></p>`;',
    ].join('\n');
    assert.deepEqual(found(code), [
      [2, 'duration'],
      [3, 'easing'],
      [5, 'duration'],
      [6, 'duration'],
      [7, 'duration'],
      [7, 'easing'],
    ]);
  });

  it('accepts durations and easings from tokens on later lines, and numbers that are no options', () => {
    const code = [
      '.tab {',
      '  transition:',
      '    background-color var(--motion-instant) var(--ease-standard),',
      '    box-shadow var(--motion-fast) var(--ease-standard);',
      '}',
      'el.animate(frames, {',
      '  duration: motionOf(this, "--motion-base"),',
      "  easing: easingOf(this, '--ease-out'),",
      '});',
      'const length = animate ? duration : 0;',
      'const armDelay = 500;',
      "const ease = getComputedStyle(el).getPropertyValue(`--ease-${name}`) || 'ease';",
    ].join('\n');
    assert.deepEqual(found(code), []);
  });

  it('finds shadows whose value continues on later lines, but accepts rings there', () => {
    const css = [
      '.card {',
      '  box-shadow:',
      '    0 4px 12px rgb(0 0 0 / 20%),',
      '    0 1px 3px rgb(0 0 0 / 10%);',
      '}',
      '.field:focus {',
      '  box-shadow:',
      '    0 0 0 2px var(--focus-ring);',
      '}',
      '.menu { box-shadow:',
      '  var(--shadow-popover) }',
    ].join('\n');
    assert.deepEqual(found(css), [[3, 'shadow']]);
  });

  it('leaves out comments', () => {
    const code = [
      '/* A transition of 120ms that eases out: ease-out. */',
      '.tab { transition: opacity var(--motion-fast) var(--ease-out); }',
      '/*',
      ' * The animation takes 1s,',
      ' * with box-shadow: 0 4px 12px black.',
      ' */',
      '// The transition takes 180ms.',
      'const wait = 3; // The delay is 2s.',
    ].join('\n');
    assert.deepEqual(found(code), []);
  });
});

describe('checkTokens', () => {
  it('finds nothing in the interface of the browser', () => {
    assert.deepEqual(checkTokens(resolve(import.meta.dirname, '../..')), []);
  });
});
