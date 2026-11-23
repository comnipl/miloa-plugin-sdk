import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.tsx',
    testing: 'src/testing/contractHost.ts',
    'build/vite': 'src/build/vite.ts',
    'build/dev': 'src/build/dev.ts',
  },
  format: 'esm',
  fixedExtension: false,
  dts: true,
  deps: {
    neverBundle: [/^(react|react-dom|vite)(\/|$)/],
  },
});
