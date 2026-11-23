export const PLUGIN_API_SCOPES = ['entries:read', 'entries:write', 'tags:read', 'ui:navigate', 'ui:print'] as const;

export type PluginApiScope = (typeof PLUGIN_API_SCOPES)[number];

export const PLUGIN_LIMITS = {
  /** UTF-8 bytes of code and style together. */
  contentBytes: 10 * 1024 * 1024,
  /** UTF-8 bytes of the manifest as JSON. */
  manifestBytes: 16 * 1024,
  apiScopes: 16,
} as const;

export interface PluginPermissions {
  readonly api?: readonly PluginApiScope[];
}

export interface PluginViewContribution {
  readonly name: string;
  readonly icon?: string | null;
  readonly has_settings?: boolean;
}

export interface PluginManifest {
  readonly manifest_version: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string | null;
  readonly author?: string | null;
  readonly sdk: string;
  readonly view?: PluginViewContribution | null;
  readonly permissions: PluginPermissions;
}

/** The contents of a .miloaplugin file. */
export interface PluginPackage {
  readonly format: 1;
  readonly manifest: PluginManifest;
  readonly code: string;
  readonly style?: string | null;
}
