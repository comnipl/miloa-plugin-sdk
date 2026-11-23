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
 * Provider that supplies a {@link PluginClient} to the SDK hooks. definePlugin sets it up
 * automatically, so plugin authors use it directly only in test harnesses and the like.
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
        // Do not throw a TypeError when a host/SDK version mismatch gives the payload an unexpected shape
        if (!isRecord(payload)) return;
        setConfig(payload.config);
      }),
    [client],
  );

  // Apply the theme with the same class convention as the app ('dark' on documentElement)
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
