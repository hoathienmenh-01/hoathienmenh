#!/usr/bin/env node
/**
 * check-i18n-parity.mjs — Verify VI/EN i18n key parity for Xuân Tôi.
 *
 * Flattens both vi.json and en.json, then reports keys present in one
 * but missing in the other. Exits 1 if any mismatch found.
 *
 * Usage:
 *   node scripts/check-i18n-parity.mjs
 *   pnpm check:i18n
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const viPath = resolve(ROOT, 'apps/web/src/i18n/vi.json');
const enPath = resolve(ROOT, 'apps/web/src/i18n/en.json');

function flatKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const vi = JSON.parse(readFileSync(viPath, 'utf8'));
const en = JSON.parse(readFileSync(enPath, 'utf8'));

const viKeys = new Set(flatKeys(vi));
const enKeys = new Set(flatKeys(en));

const missingInEn = [...viKeys].filter((k) => !enKeys.has(k));
const missingInVi = [...enKeys].filter((k) => !viKeys.has(k));

console.log(`[i18n-parity] VI keys: ${viKeys.size} | EN keys: ${enKeys.size}`);

if (missingInEn.length === 0 && missingInVi.length === 0) {
  console.log('[i18n-parity] ✓ Perfect parity — no missing keys.');
  process.exit(0);
}

if (missingInEn.length > 0) {
  console.error(`[i18n-parity] ✗ ${missingInEn.length} key(s) in VI but missing in EN:`);
  for (const k of missingInEn.slice(0, 20)) console.error(`  - ${k}`);
  if (missingInEn.length > 20) console.error(`  ... and ${missingInEn.length - 20} more`);
}

if (missingInVi.length > 0) {
  console.error(`[i18n-parity] ✗ ${missingInVi.length} key(s) in EN but missing in VI:`);
  for (const k of missingInVi.slice(0, 20)) console.error(`  - ${k}`);
  if (missingInVi.length > 20) console.error(`  ... and ${missingInVi.length - 20} more`);
}

process.exit(1);
