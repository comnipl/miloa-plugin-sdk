export const SETTINGS_LAYOUT_STYLE_ID = 'miloa-settings-layout';

/**
 * settings モードでは view 用 CSS の `height: 100%` が iframe ビューポートを拾ってしまう。
 * これを無効化し、文書をコンテンツ高さに合わせる。
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
 * settings 文書のコンテンツ高さ。ホストへ報告し、そのまま settings iframe の高さになる値。
 *
 * `#root` の子要素の border box 下端から求める。`#root` / `documentElement` の
 * scrollHeight は iframe ビューポートを下限に含むことがあり、縮小が伝播しない。
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
