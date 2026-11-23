export const SETTINGS_LAYOUT_STYLE_ID = 'miloa-settings-layout';

/**
 * In settings mode, the view CSS's `height: 100%` picks up the iframe viewport.
 * This disables it and fits the document to the content height.
 */
export function applySettingsLayoutStyles(doc: Document = document): void {
  if (doc.getElementById(SETTINGS_LAYOUT_STYLE_ID) != null) return;
  const style = doc.createElement('style');
  style.id = SETTINGS_LAYOUT_STYLE_ID;
  style.textContent = `
    html, body, #root {
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
    }
  `;
  doc.head.appendChild(style);
}

/**
 * Content height of the settings document. Reported to the host, and used as is as the settings iframe height.
 *
 * Computed from the bottom of the border boxes of `#root`'s children. The scrollHeight of `#root` / `documentElement`
 * can include the iframe viewport as a lower bound, so shrinking does not propagate.
 */
export function measureSettingsContentHeight(doc: Document = document): number {
  const root = doc.getElementById('root');
  if (root == null) return 0;
  const rootRect = root.getBoundingClientRect();
  let contentBottom = 0;
  for (const child of root.children) {
    const rect = child.getBoundingClientRect();
    contentBottom = Math.max(contentBottom, rect.bottom - rootRect.top);
  }
  if (contentBottom > 0) {
    const style = doc.defaultView?.getComputedStyle(root);
    const paddingBottom = style == null ? 0 : Number.parseFloat(style.paddingBottom) || 0;
    return Math.ceil(contentBottom + paddingBottom);
  }
  return root.scrollHeight;
}
