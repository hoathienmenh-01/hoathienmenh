import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/realms.ts',
    'src/proverbs.ts',
    'src/enums.ts',
    'src/ws-events.ts',
    'src/api-contracts.ts',
    'src/combat.ts',
    'src/items.ts',
    'src/body-cultivation.ts',
    'src/missions.ts',
    'src/topup.ts',
    'src/boss.ts',
    'src/map-regions.ts',
    'src/balance-dials.ts',
    'src/elemental.ts',
    'src/equipment-progression.ts',
    'src/notification.ts',
    'src/inventory-sort.ts',
    'src/loadout-presets.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  target: 'es2022',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' };
  },
});
