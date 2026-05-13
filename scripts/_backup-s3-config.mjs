#!/usr/bin/env node
// Phase 17.2 — Shell-facing wrapper cho `backup-s3-config.ts`.
//
// Bash scripts (`backup-to-s3.sh`, `restore-verify-weekly.sh`) eval output
// dạng pipe-delimited:
//   OK|endpoint=...|region=...|bucket=...|prefix=...|forcePathStyle=true|sse=...|retentionDays=0|accessKeyId=masked|secretMasked=...|verifyTmpDb=...|verifyTmpRetain=false
//   INVALID|missing=BACKUP_S3_BUCKET,BACKUP_S3_ACCESS_KEY_ID|invalid=BACKUP_S3_SSE
//
// Run: `node scripts/_backup-s3-config.mjs` (env vars in process.env).
//
// Đồng bộ logic 1-1 với `apps/api/src/ops/backup-s3-config.ts` (port JS).

const REQUIRED_KEYS = [
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
];

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = String(raw).toLowerCase().trim();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return fallback;
}

function normalizePrefix(raw) {
  const trimmed = (raw ?? '').trim();
  const p = trimmed === '' ? 'xuantoi/backups/' : trimmed;
  return p.endsWith('/') ? p : `${p}/`;
}

function parseSse(raw) {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: '' };
  const lower = trimmed.toLowerCase();
  if (lower === 'aes256') return { ok: true, value: 'AES256' };
  if (lower === 'aws:kms') return { ok: true, value: 'aws:kms' };
  return { ok: false };
}

const DB_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function parseInteger(raw, fallback) {
  if (raw === undefined || raw === '') return { ok: true, value: fallback };
  if (!/^-?\d+$/.test(String(raw).trim())) return { ok: false };
  return { ok: true, value: Number.parseInt(raw, 10) };
}

function maskSecret(secret) {
  if (secret.length < 10) return '*'.repeat(secret.length);
  const head = secret.slice(0, 4);
  const tail = secret.slice(-2);
  return `${head}${'*'.repeat(Math.max(4, secret.length - 6))}${tail}`;
}

function maskAccessKey(key) {
  if (key.length < 8) return '*'.repeat(key.length);
  return `${key.slice(0, 4)}${'*'.repeat(key.length - 8)}${key.slice(-4)}`;
}

function main() {
  const env = process.env;
  const missing = [];
  for (const k of REQUIRED_KEYS) {
    const v = (env[k] ?? '').trim();
    if (v === '') missing.push(k);
  }

  const invalid = [];
  const sseRes = parseSse(env.BACKUP_S3_SSE);
  if (!sseRes.ok) invalid.push('BACKUP_S3_SSE');

  const verifyTmpDb = (env.BACKUP_VERIFY_TMP_DB ?? '').trim() || 'xuantoi_verify';
  if (!DB_NAME_PATTERN.test(verifyTmpDb)) invalid.push('BACKUP_VERIFY_TMP_DB');

  const retentionRes = parseInteger(env.BACKUP_RETENTION_DAYS, 0);
  if (!retentionRes.ok) invalid.push('BACKUP_RETENTION_DAYS');
  else if (retentionRes.value < 0) invalid.push('BACKUP_RETENTION_DAYS');

  if (missing.length > 0 || invalid.length > 0) {
    const parts = ['INVALID'];
    if (missing.length > 0) parts.push(`missing=${missing.join(',')}`);
    if (invalid.length > 0) parts.push(`invalid=${invalid.join(',')}`);
    process.stdout.write(parts.join('|') + '\n');
    process.exit(0);
  }

  const cfg = {
    endpoint: env.BACKUP_S3_ENDPOINT.trim(),
    region: (env.BACKUP_S3_REGION ?? '').trim() || 'us-east-1',
    bucket: env.BACKUP_S3_BUCKET.trim(),
    prefix: normalizePrefix(env.BACKUP_S3_PREFIX),
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID.trim(),
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY.trim(),
    forcePathStyle: parseBool(env.BACKUP_S3_FORCE_PATH_STYLE, true),
    sse: sseRes.value,
    verifyTmpDb,
    verifyTmpRetain: parseBool(env.BACKUP_VERIFY_TMP_RETAIN, false),
    retentionDays: retentionRes.value,
  };

  const fields = [
    'OK',
    `endpoint=${cfg.endpoint}`,
    `region=${cfg.region}`,
    `bucket=${cfg.bucket}`,
    `prefix=${cfg.prefix}`,
    `forcePathStyle=${cfg.forcePathStyle}`,
    `sse=${cfg.sse}`,
    `retentionDays=${cfg.retentionDays}`,
    `accessKeyId=${maskAccessKey(cfg.accessKeyId)}`,
    `secretMasked=${maskSecret(cfg.secretAccessKey)}`,
    `verifyTmpDb=${cfg.verifyTmpDb}`,
    `verifyTmpRetain=${cfg.verifyTmpRetain}`,
  ];
  process.stdout.write(fields.join('|') + '\n');
}

main();
