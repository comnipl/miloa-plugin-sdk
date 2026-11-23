import { useCallback } from 'react';

import { useMiloaContext } from './provider';

export interface PrintOptions {
  /** Root element to print. Defaults to the frame's `#root` (everything the plugin renders). */
  root?: HTMLElement | null;
  /** Title of the print job. Used, for example, as the default file name when saving as PDF. */
  title?: string;
}

/**
 * The frame's CSS is a same-origin sheet with the package styles inlined, so `cssRules` is
 * readable. If some sheets are unreadable, it still prints and collects the ones it can read.
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

/** Elements whose live properties are not reflected in attributes. These are written back before serializing. */
const LIVE_STATE_SELECTOR = 'input, textarea, option';

function elementsToMaterialize(root: Element): Element[] {
  const found = Array.from(root.querySelectorAll(LIVE_STATE_SELECTOR));
  return root.matches(LIVE_STATE_SELECTOR) ? [root, ...found] : found;
}

/**
 * `outerHTML` drops live properties such as `input.value` / `checked` / `option.selected` / `textarea.value`,
 * so serializing it as is makes the printed page differ from what the screen shows.
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
 * Returns a function that opens the host's print dialog. Requires scope: `ui:print`.
 *
 * The frame itself cannot call `window.print()` (sandbox), so it passes the rendered HTML and CSS
 * to the host, and the host builds a print-only document and prints it. The plugin's
 * `@media print` / `@page` rules apply as is, and page breaks split pages as intended.
 *
 * The host receives a snapshot of the DOM at call time, so if the printed page should differ
 * from the screen, render the state you want to print first and then call it. Like `useOpenEntry`,
 * it only logs failures to the console and does not throw.
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
