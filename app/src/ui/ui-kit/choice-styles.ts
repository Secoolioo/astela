import { css } from 'lit';

/**
 * Styles of the choice controls of internal pages: segmented buttons and accent swatches,
 * both built from native radio buttons, so they work with the keyboard and screen readers.
 */
export const choiceStyles = css`
  .segments {
    display: inline-flex;
    border: 1px solid var(--border-1);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .segments label {
    position: relative;
    padding: var(--space-1) var(--space-3);
    line-height: var(--line-height-large);
    transition:
      background-color var(--motion-fast) var(--ease-standard),
      color var(--motion-fast) var(--ease-standard);
  }
  .segments label + label {
    border-left: 1px solid var(--border-1);
  }
  .segments label:has(input:checked) {
    background: var(--accent);
    color: var(--surface-0);
  }
  .segments label:has(input:focus-visible),
  .swatches label:has(input:focus-visible),
  .card:has(input:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  input[type='radio'] {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .swatches label {
    position: relative;
    width: var(--swatch-size, 24px);
    height: var(--swatch-size, 24px);
    border-radius: 50%;
    box-sizing: border-box;
    border: 2px solid transparent;
  }
  .swatches label:has(input:checked) {
    border-color: var(--text-1);
  }
  .swatch {
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--swatch-light);
    pointer-events: none;
  }
  @media (prefers-color-scheme: dark) {
    .swatch {
      background: var(--swatch-dark);
    }
  }
  input[type='color'] {
    width: var(--swatch-size, 24px);
    height: var(--swatch-size, 24px);
    padding: 0;
    border: 1px solid var(--border-1);
    border-radius: var(--radius-1);
    background: none;
  }
  label:has(:disabled),
  :disabled {
    opacity: 0.6;
  }
`;

/**
 * Switches: a checkbox with the role `switch` as a track whose knob slides to the end when it
 * is on. The track has the contrast of secondary text while it is off.
 */
export const switchStyles = css`
  input[role='switch'] {
    appearance: none;
    position: relative;
    flex: none;
    width: 32px;
    height: 18px;
    margin: 0;
    border-radius: var(--radius-pill);
    background: var(--text-2);
    transition: background-color var(--motion-fast) var(--ease-standard);
  }
  input[role='switch']::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-pill);
    background: var(--surface-1);
    transition: transform var(--motion-base) var(--ease-standard);
  }
  input[role='switch']:checked {
    background: var(--accent);
  }
  input[role='switch']:checked::before {
    transform: translateX(14px);
  }
  input[role='switch']:disabled {
    opacity: 0.5;
  }
  input[role='switch']:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
`;
