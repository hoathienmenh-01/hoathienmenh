/**
 * Phase 17.2 — Smoke test cho `scripts/backup-to-s3.sh` +
 * `scripts/restore-verify-weekly.sh` + `scripts/_backup-s3-config.mjs`.
 *
 * KHÔNG đụng aws CLI / S3 / DB thật. Chỉ verify:
 *   - DRY_RUN=1 với env hợp lệ → exit 0 + plan text in stdout.
 *   - env trống → exit 2 + log thiếu key.
 *   - invalid SSE → exit 2 + log invalid.
 *
 * Vì scripts là bash, vitest spawn `bash` qua child_process.spawnSync.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const BACKUP_SH = join(REPO_ROOT, 'scripts', 'backup-to-s3.sh');
const VERIFY_SH = join(REPO_ROOT, 'scripts', 'restore-verify-weekly.sh');
const CONFIG_MJS = join(REPO_ROOT, 'scripts', '_backup-s3-config.mjs');

function runBash(
  script: string,
  env: Record<string, string>,
): { code: number | null; stdout: string; stderr: string } {
  const res = spawnSync('bash', [script], {
    env: { ...process.env, ...env, PATH: process.env.PATH ?? '' },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function runNode(
  script: string,
  env: Record<string, string>,
): { code: number | null; stdout: string; stderr: string } {
  const res = spawnSync('node', [script], {
    env: { ...process.env, ...env, PATH: process.env.PATH ?? '' },
    encoding: 'utf-8',
    timeout: 5_000,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('Phase 17.2 — script files exist', () => {
  it('scripts/backup-to-s3.sh exists', () => {
    expect(existsSync(BACKUP_SH)).toBe(true);
  });
  it('scripts/restore-verify-weekly.sh exists', () => {
    expect(existsSync(VERIFY_SH)).toBe(true);
  });
  it('scripts/_backup-s3-config.mjs exists', () => {
    expect(existsSync(CONFIG_MJS)).toBe(true);
  });
});

describe('Phase 17.2 — _backup-s3-config.mjs (shell-facing wrapper)', () => {
  it('empty env → INVALID with all 4 missing keys', () => {
    // Strip parent process BACKUP_S3_* env if any.
    const filteredEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('BACKUP_')) continue;
      if (typeof v === 'string') filteredEnv[k] = v;
    }
    const r = spawnSync('node', [CONFIG_MJS], {
      env: filteredEnv,
      encoding: 'utf-8',
      timeout: 5_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('INVALID|');
    expect(r.stdout).toContain('BACKUP_S3_ENDPOINT');
    expect(r.stdout).toContain('BACKUP_S3_BUCKET');
    expect(r.stdout).toContain('BACKUP_S3_ACCESS_KEY_ID');
    expect(r.stdout).toContain('BACKUP_S3_SECRET_ACCESS_KEY');
  });

  it('valid env → OK with defaults', () => {
    const r = runNode(CONFIG_MJS, {
      BACKUP_S3_ENDPOINT: 'https://s3.example.com',
      BACKUP_S3_BUCKET: 'xuantoi-prod',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLEEXAMPLE',
      BACKUP_S3_SECRET_ACCESS_KEY: 'verysecretsecret1234567',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^OK\|/);
    expect(r.stdout).toContain('region=us-east-1');
    expect(r.stdout).toContain('prefix=xuantoi/backups/');
    expect(r.stdout).toContain('forcePathStyle=true');
    expect(r.stdout).toContain('verifyTmpDb=xuantoi_verify');
    expect(r.stdout).not.toContain('verysecretsecret');
  });

  it('invalid SSE → INVALID', () => {
    const r = runNode(CONFIG_MJS, {
      BACKUP_S3_ENDPOINT: 'https://s3.example.com',
      BACKUP_S3_BUCKET: 'xuantoi-prod',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIA',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
      BACKUP_S3_SSE: 'unknown',
    });
    expect(r.stdout).toContain('INVALID|');
    expect(r.stdout).toContain('BACKUP_S3_SSE');
  });

  it('SQL-injectable verifyTmpDb → INVALID', () => {
    const r = runNode(CONFIG_MJS, {
      BACKUP_S3_ENDPOINT: 'https://s3.example.com',
      BACKUP_S3_BUCKET: 'xuantoi-prod',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIA',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
      BACKUP_VERIFY_TMP_DB: '"; DROP TABLE users--',
    });
    expect(r.stdout).toContain('INVALID|');
    expect(r.stdout).toContain('BACKUP_VERIFY_TMP_DB');
  });
});

describe('Phase 17.2 — backup-to-s3.sh smoke', () => {
  it('empty env → exit 2 with all 4 missing keys logged', () => {
    const filteredEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('BACKUP_')) continue;
      if (typeof v === 'string') filteredEnv[k] = v;
    }
    const r = spawnSync('bash', [BACKUP_SH], {
      env: filteredEnv,
      encoding: 'utf-8',
      timeout: 15_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('FATAL');
    expect(r.stderr).toContain('BACKUP_S3_ENDPOINT');
  });

  it('DRY_RUN=1 with valid env + existing local backup file → exit 0', () => {
    // Create a dummy backup file.
    const tmpDir = join(REPO_ROOT, '.tmp-backup-smoke');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir);
    const dummyFile = join(tmpDir, 'xuantoi-20260513-150000.sql.gz');
    writeFileSync(dummyFile, 'dummy');

    try {
      const r = runBash(BACKUP_SH, {
        BACKUP_S3_ENDPOINT: 'https://s3.example.com',
        BACKUP_S3_BUCKET: 'xuantoi-prod',
        BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLEEXAMPLE',
        BACKUP_S3_SECRET_ACCESS_KEY: 'verysecretsecret1234567',
        BACKUP_DIR: tmpDir,
        DRY_RUN: '1',
      });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('DRY_RUN=1');
      expect(r.stdout).toContain('s3://xuantoi-prod/xuantoi/backups/xuantoi-20260513-150000.sql.gz');
      expect(r.stdout).not.toContain('verysecretsecret1234567');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('valid env but BACKUP_DIR empty → exit 4', () => {
    const tmpDir = join(REPO_ROOT, '.tmp-backup-empty');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir);
    try {
      const r = runBash(BACKUP_SH, {
        BACKUP_S3_ENDPOINT: 'https://s3.example.com',
        BACKUP_S3_BUCKET: 'xuantoi-prod',
        BACKUP_S3_ACCESS_KEY_ID: 'AKIA',
        BACKUP_S3_SECRET_ACCESS_KEY: 'verysecretsecret1234567',
        BACKUP_DIR: tmpDir,
        DRY_RUN: '1',
      });
      expect(r.code).toBe(4);
      expect(r.stderr).toContain('không tìm thấy file');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Phase 17.2 — restore-verify-weekly.sh smoke', () => {
  it('DRY_RUN=1 with valid S3 env → exit 0 + S3 LATEST plan', () => {
    const r = runBash(VERIFY_SH, {
      BACKUP_S3_ENDPOINT: 'https://s3.example.com',
      BACKUP_S3_BUCKET: 'xuantoi-prod',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLEEXAMPLE',
      BACKUP_S3_SECRET_ACCESS_KEY: 'verysecretsecret1234567',
      DRY_RUN: '1',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('S3 LATEST');
    expect(r.stdout).toContain('xuantoi_verify');
    // Verify secret KHÔNG bị in trong stdout (mask).
    expect(r.stdout).not.toContain('verysecretsecret1234567');
  });

  it('DRY_RUN=1 with BACKUP_VERIFY_LOCAL → exit 0 + LOCAL FILE plan', () => {
    const r = runBash(VERIFY_SH, {
      BACKUP_VERIFY_LOCAL: './backups/foo.sql.gz',
      DRY_RUN: '1',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('LOCAL FILE');
    expect(r.stdout).toContain('./backups/foo.sql.gz');
  });

  it('empty env without BACKUP_VERIFY_LOCAL → exit 2', () => {
    const filteredEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('BACKUP_')) continue;
      if (typeof v === 'string') filteredEnv[k] = v;
    }
    const r = spawnSync('bash', [VERIFY_SH], {
      env: filteredEnv,
      encoding: 'utf-8',
      timeout: 15_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('BACKUP_S3_ENDPOINT');
  });
});
