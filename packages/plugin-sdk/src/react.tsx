import { Component, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { createPluginClient } from './client';
import { toError } from './hooks';
import { MiloaProvider, useMiloaContext } from './provider';
import {
  applySettingsLayoutStyles,
  measureSettingsContentHeight,
} from './settingsLayout';
import { FRAME_ERROR_MESSAGE_TYPE, type FrameErrorMessage } from '@comnipl/miloa-plugin-contract';

export { MiloaProvider } from './provider';
export {
  useAllEntries,
  useDraftConfig,
  useEntry,
  useEntryCounts,
  useEntryMutations,
  useEntrySearch,
  useMiloa,
  useOpenEntry,
  useTags,
  useWatch,
  type AllEntriesParams,
  type EntryMutations,
  type MiloaInfo,
  type UseAllEntriesResult,
  type UseEntryResult,
  type UseEntryCountsResult,
  type UseEntrySearchResult,
  type UseTagsResult,
  type UseWatchResult,
  type WatchSpec,
} from './hooks';
export { usePrint, type PrintOptions } from './print';

function reportFrameError(error: unknown): void {
  const message: FrameErrorMessage = {
    type: FRAME_ERROR_MESSAGE_TYPE,
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  try {
    window.parent.postMessage(message, '*');
  } catch {
    // frame が切り離された後は window.parent が null になり、通知先が無い
  }
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** クラッシュをエラー表示に変換しつつ、watchdog と同じ経路でホストにも通知する。 */
class PluginErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown): void {
    reportFrameError(error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
          <strong>Plugin crashed</strong>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function SettingsNotProvided() {
  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      This plugin does not provide a settings UI.
    </div>
  );
}

function SettingsContentHeightReporter() {
  const { client } = useMiloaContext();
  const lastHeightRef = useRef(0);

  useEffect(() => {
    const root = document.getElementById('root');
    if (root == null) return;

    const report = () => {
      const rounded = Math.ceil(measureSettingsContentHeight());
      if (rounded <= 0 || rounded === lastHeightRef.current) return;
      lastHeightRef.current = rounded;
      client.request('view.set_content_height', { height: rounded }).catch((error: unknown) => {
        console.error('@comnipl/miloa-plugin-sdk: view.set_content_height failed', error);
      });
    };

    const reportAfterNextPaint = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          report();
        });
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      reportAfterNextPaint();
    });
    resizeObserver.observe(root);

    const mutationObserver = new MutationObserver(() => {
      reportAfterNextPaint();
    });
    mutationObserver.observe(root, { childList: true, subtree: true, attributes: true });

    reportAfterNextPaint();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [client]);

  return null;
}

export interface PluginDefinition {
  /** view モードで描画されるコンポーネント。 */
  View: ComponentType;
  /** settings モードで描画されるコンポーネント (manifest の `view.has_settings` 用)。 */
  Settings?: ComponentType;
}

/**
 * プラグインのエントリポイント。ハンドシェイク完了後に `#root` へ React root を
 * 作成し、mode に応じて View / Settings を描画する。バンドルのトップレベルで
 * 1 度だけ呼ぶこと。
 */
export function definePlugin(definition: PluginDefinition): void {
  void bootstrap(definition);
}

async function bootstrap({ View, Settings }: PluginDefinition): Promise<void> {
  try {
    const client = await createPluginClient();
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('#root element not found in plugin frame');
    }
    if (client.init.mode === 'settings') {
      applySettingsLayoutStyles();
    }
    const Body = client.init.mode === 'settings' ? (Settings ?? SettingsNotProvided) : View;
    createRoot(container).render(
      <PluginErrorBoundary>
        <MiloaProvider client={client}>
          {client.init.mode === 'settings' ? <SettingsContentHeightReporter /> : null}
          <Body />
        </MiloaProvider>
      </PluginErrorBoundary>,
    );
  } catch (error) {
    reportFrameError(error);
    const container = document.getElementById('root');
    if (container) {
      container.textContent =
        error instanceof Error ? error.message : 'Failed to initialize plugin';
    }
  }
}
