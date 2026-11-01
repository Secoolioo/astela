import { css } from 'lit';

/**
 * Styles of the choice controls of internal pages: segmented buttons and accent swatches,
 * both built from native radio buttons, so they work with the keyboard and screen readers.
 */
export const choiceStyles = css`
  .segments {
    display: inline-flex;
    border: 1px solid var(--border-1);
    border-radius: var(--radius-1);
    overflow: hidden;
  }
  .segments label {
    position: relative;
    padding: var(--space-1) var(--space-3);
    line-height: 20px;
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
