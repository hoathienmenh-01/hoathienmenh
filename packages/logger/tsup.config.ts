import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'backend/index': 'src/backend/index.ts',
    'frontend/index': 'src/frontend/index.ts',
    types: 'src/types.ts',
    redact: 'src/redact.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  sourcemap: true,
});
