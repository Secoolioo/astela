import { css, html, svg, type TemplateResult } from 'lit';
import type { LayoutPresetId } from '../../shared/layout-presets.ts';

/**
 * The parts of each preview in a 160 by 90 box: the page, the toolbar, and the tabs in the
 * accent color, where the preset puts them. Zen shows only the edge that stays above the page.
 */
const parts: Readonly<Record<LayoutPresetId, TemplateResult>> = {
  classic: svg`<rect class="tabs" width="160" height="12" />
    <rect class="bar" y="12" width="160" height="12" />
    <rect class="field" x="36" y="15" width="88" height="6" rx="3" />`,
  compact: svg`<rect class="bar" width="68" height="12" />
    <rect class="field" x="6" y="3" width="56" height="6" rx="3" />
    <rect class="tabs" x="68" width="92" height="12" />`,
  zen: svg`<rect class="bar" width="160" height="3" />`,
  vertical: svg`<rect class="bar" width="160" height="12" />
    <rect class="field" x="52" y="3" width="88" height="6" rx="3" />
    <rect class="tabs" y="12" width="40" height="78" />`,
};

/**
 * A small window that shows where a layout preset puts the tabs and the toolbar, drawn in the
 * colors of the page with {@link layoutPreviewStyles}.
 * @param preset - The preset.
 */
export function layoutPreview(preset: LayoutPresetId): TemplateResult {
  return html`<svg class="layout-preview" viewBox="0 0 160 90" aria-hidden="true">
    <rect class="page" width="160" height="90" />
    ${parts[preset]}
  </svg>`;
}

/** The colors of the previews; presentation attributes cannot use custom properties. */
export const layoutPreviewStyles = css`
  .layout-preview {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-1);
  }
  .layout-preview .page {
    fill: var(--surface-2);
  }
  .layout-preview .bar {
    fill: var(--surface-1);
  }
  .layout-preview .field {
    fill: var(--surface-2);
  }
  .layout-preview .tabs {
    fill: var(--accent);
  }
`;
