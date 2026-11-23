import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { PluginClient } from './client';
import type { PluginTheme } from '@comnipl/miloa-plugin-contract';

interface MiloaContextValue {
  client: PluginClient;
  theme: PluginTheme;
  config: unknown;
}

const MiloaContext = createContext<MiloaContextValue | null>(null);

/**
 * SDK hooks に {@link PluginClient} を供給する Provider。definePlugin が自動で
 * セットアップするので、プラグイン作者が直接使うのはテストハーネスくらい。
 */
export function MiloaProvider({
  client,
  children,
}: {
  client: PluginClient;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<PluginTheme>(client.init.theme);
  const [config, setConfig] = useState<unknown>(client.init.config);

  useEffect(() => client.onThemeChange(setTheme), [client]);
  useEffect(
    () =>
      client.on('config_changed', (payload) => {
        // ホスト/SDK のバージョン乖離で payload が想定外の形でも TypeError で落とさない
        if (!isRecord(payload)) return;
        setConfig(payload.config);
      }),
    [client],
  );

  // app 本体と同じ class 規約 (documentElement の 'dark') でテーマを反映する
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const value = useMemo(() => ({ client, theme, config }), [client, theme, config]);
  return <MiloaContext.Provider value={value}>{children}</MiloaContext.Provider>;
}

export function useMiloaContext(): MiloaContextValue {
  const context = useContext(MiloaContext);
  if (!context) {
    throw new Error(
      '@comnipl/miloa-plugin-sdk: hooks must be used under <MiloaProvider> (definePlugin sets it up)',
    );
  }
  return context;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
