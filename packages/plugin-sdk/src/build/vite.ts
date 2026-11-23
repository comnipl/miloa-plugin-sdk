import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_API_SCOPES, PLUGIN_LIMITS } from '@comnipl/miloa-plugin-contract';
import type { Plugin } from 'vite';

const packageJson = new URL('../../package.json', import.meta.url);
const licenseFile = new URL('../../LICENSE', import.meta.url);
const licenseReport = 'licenses.json';
const miloaPackages = ['@comnipl/miloa-plugin-sdk', '@comnipl/miloa-plugin-contract'];
const scopes = new Set<string>(PLUGIN_API_SCOPES);

interface DependencyLicense {
  name: string;
  version: string;
  identifier?: string;
  text?: string;
}

function readManifest(file: string, sdk: string) {
  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('package "manifest" must be an object');
  }
  if ('sdk' in input) throw new Error('Remove "sdk" from the manifest. The build tool writes it.');
  const manifest: Record<string, unknown> = { ...input, sdk };
  if (manifest.manifest_version !== 1) throw new Error('manifest_version must be 1');
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.id)) {
    throw new Error('manifest.id must match ^[a-z0-9][a-z0-9-]{0,63}$');
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error('manifest.name must be a non-empty string');
  }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('manifest.version must be a non-empty string');
  }
  const permissions = manifest.permissions;
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    throw new Error('manifest.permissions must be an object');
  }
  if ('api' in permissions && (!Array.isArray(permissions.api)
    || permissions.api.length > PLUGIN_LIMITS.apiScopes
    || permissions.api.some(scope => typeof scope !== 'string' || !scopes.has(scope)))) {
    throw new Error(`manifest.permissions.api must contain at most ${PLUGIN_LIMITS.apiScopes} recognized scopes`);
  }
  if ('network' in permissions && (!Array.isArray(permissions.network) || permissions.network.length !== 0)) {
    throw new Error('manifest.permissions.network must be empty: plugins cannot reach external hosts');
  }
  if (Buffer.byteLength(JSON.stringify(manifest)) > PLUGIN_LIMITS.manifestBytes) {
    throw new Error(`manifest must not exceed ${PLUGIN_LIMITS.manifestBytes} bytes`);
  }
  return { ...manifest, id: manifest.id };
}

export function miloaPlugin({ entry = 'src/main.tsx', manifest = 'manifest.json' }: {
  entry?: string;
  manifest?: string;
} = {}): Plugin {
  let manifestPath: string;
  return {
    name: 'miloa-plugin',
    apply: 'build',
    config() {
      return {
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          license: { fileName: licenseReport },
          lib: { entry, name: 'MiloaPlugin', formats: ['iife'], fileName: () => 'plugin.js' },
          cssCodeSplit: false,
          rolldownOptions: { output: { assetFileNames: 'plugin[extname]' } },
        },
      };
    },
    configResolved(config) {
      manifestPath = resolve(config.root, manifest);
    },
    buildStart() {
      this.addWatchFile(manifestPath);
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const script = bundle['plugin.js'];
        if (script?.type !== 'chunk' || script.code === '') {
          throw new Error('package "code" must be a non-empty string');
        }
        const css = bundle['plugin.css'];
        const style = css?.type === 'asset' ? css.source.toString() : null;
        const report = bundle[licenseReport];
        if (report?.type !== 'asset') throw new Error(`Missing Vite's ${licenseReport}`);

        const { version } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version: string };
        const outputManifest = readManifest(manifestPath, version);
        const license = readFileSync(licenseFile, 'utf8');
        const dependencies = JSON.parse(report.source.toString()) as DependencyLicense[];
        const notices = dependencies
          .filter(({ name }) => !miloaPackages.includes(name))
          .map(({ name, version, identifier, text }) =>
            [`${name} ${version}`, identifier, text].filter(value => value !== undefined).join('\n'),
          );
        const notice = [miloaPackages.join('\n'), license, ...notices].join('\n\n').replace(/\*\//g, '* /');
        const code = `/*!\n${notice}\n*/\n${script.code}`;
        if (Buffer.byteLength(code) + Buffer.byteLength(style ?? '') > PLUGIN_LIMITS.contentBytes) {
          throw new Error(`plugin code and style must not exceed ${PLUGIN_LIMITS.contentBytes} bytes in total`);
        }

        const source = JSON.stringify({ format: 1, manifest: outputManifest, code, style });
        const packed = JSON.parse(source) as { code: string };
        if (!packed.code.includes(license)) throw new Error('The package is missing the SDK license');
        this.emitFile({ type: 'asset', fileName: `${outputManifest.id}.miloaplugin`, source });
      },
    },
  };
}
