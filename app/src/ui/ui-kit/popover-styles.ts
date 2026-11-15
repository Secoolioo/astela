import { css } from 'lit';

/**
 * The look of every popover of the overlay, such as the menus, the popovers of buttons and the
 * questions of sites: a surface that floats above the panels, inside the calm line, with the
 * rounder corners and the one shadow of surfaces that float (ADR 0046, ADR 0050, ADR 0051).
 * Forced colors take the shadow away, so the line carries the popover there.
 */
export const popoverStyles = css`
  .popover {
    box-sizing: border-box;
    border: 1px solid var(--line-1);
    border-radius: var(--radius-3);
    background: var(--surface-raised);
    box-shadow: var(--shadow-popover);
    color: var(--text-1);
  }
  @media (forced-colors: active) {
    .popover {
      border-color: CanvasText;
    }
  }
`;
