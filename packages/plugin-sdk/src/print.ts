import { useCallback } from 'react';

import { useMiloaContext } from './provider';

export interface PrintOptions {
  /** 印刷対象のルート要素。既定は frame の `#root` (プラグインの描画結果全体)。 */
  root?: HTMLElement | null;
  /** 印刷ジョブの表題。PDF 保存時の既定ファイル名などに使われる。 */
  title?: string;
}

/**
 * frame の CSS はパッケージの style を inline した同一 origin のシートなので `cssRules` を
 * 読める。読めないシートが混ざっても印刷を諦めず、読める分だけ集める。
 */
function collectFrameCss(doc: Document): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) chunks.push(rule.cssText);
  }
  return chunks.join('\n');
}

/** live property が属性に反映されない要素。serialize 前に書き戻す対象。 */
const LIVE_STATE_SELECTOR = 'input, textarea, option';

function elementsToMaterialize(root: Element): Element[] {
  const found = Array.from(root.querySelectorAll(LIVE_STATE_SELECTOR));
  return root.matches(LIVE_STATE_SELECTOR) ? [root, ...found] : found;
}

/**
 * `outerHTML` は `input.value` / `checked` / `option.selected` / `textarea.value`
 * といった live property を落とすため、そのまま直列化すると画面の状態と紙面がずれる。
 */
function materializeLiveState(source: Element, clone: Element): void {
  const originals = elementsToMaterialize(source);
  const copies = elementsToMaterialize(clone);
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (copy === undefined) return;
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      copy.setAttribute('value', original.value);
      if (original.checked) copy.setAttribute('checked', '');
      else copy.removeAttribute('checked');
    } else if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.textContent = original.value;
    } else if (original instanceof HTMLOptionElement && copy instanceof HTMLOptionElement) {
      if (original.selected) copy.setAttribute('selected', '');
      else copy.removeAttribute('selected');
    }
  });
}

function serializeForPrint(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  materializeLiveState(root, clone);
  return clone.outerHTML;
}

/**
 * ホストの印刷ダイアログを開く関数を返す。要 scope: `ui:print`。
 *
 * frame 自身は `window.print()` を呼べない (sandbox) ため、描画結果の HTML と CSS を
 * ホストへ渡し、ホストが印刷専用ドキュメントを組み立てて印刷する。プラグインの
 * `@media print` / `@page` はそのまま効き、改ページも意図どおり分割される。
 *
 * ホストへ渡るのは呼び出し時点の DOM のスナップショットなので、画面表示と紙面が
 * 異なるなら印刷したい状態を先に描画してから呼ぶこと。`useOpenEntry` と同じく
 * 失敗は console に出すだけで throw しない。
 */
export function usePrint(): (options?: PrintOptions) => void {
  const { client } = useMiloaContext();
  return useCallback(
    (options: PrintOptions = {}) => {
      const root = options.root ?? document.getElementById('root');
      if (root == null) {
        console.error('@comnipl/miloa-plugin-sdk: usePrint found no root element to print');
        return;
      }
      client
        .request('ui.print', {
          html: serializeForPrint(root),
          css: collectFrameCss(document),
          title: options.title,
        })
        .catch((error: unknown) => {
          console.error('@comnipl/miloa-plugin-sdk: ui.print failed', error);
        });
    },
    [client],
  );
}
