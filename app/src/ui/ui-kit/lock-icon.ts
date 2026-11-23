import { css, svg } from 'lit';

/** The mark of values that the organization sets, in front of the note that says so. */
export const lockIcon = svg`<svg class="lock" viewBox="0 0 16 16" aria-hidden="true">
  <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5" />
</svg>`;

/** The size and place of {@link lockIcon} in a line of text. */
export const lockStyles = css`
  .lock {
    width: 12px;
    height: 12px;
    margin-right: var(--space-1);
    vertical-align: -1px;
  }
`;
