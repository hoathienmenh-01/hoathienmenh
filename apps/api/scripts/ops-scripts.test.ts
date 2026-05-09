import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase 17.4 — Smoke tests for ops scripts in repo `scripts/` directory.
 *
 * KHÔNG chạm DB / pg_dump / psql / docker thật — chỉ verify:
 *   1) Script tồn tại + có shebang.
 *   2) `bash -n` syntax check không lỗi.
 *   3) Restore script CHẶN khi NODE_ENV=production và không có
 *      `ALLOW_PRODUCTION_RESTORE=YES` (exit 9).
 *   4) Restore script CHẶN khi không có argument backup file (exit 1).
 *   5) Restore script CHẶN khi backup file không tồn tại (exit 2).
 *   6) Backup script DRY_RUN không spawn pg_dump (exit 0 nhanh).
 *   7) Verify-restore script tồn tại + bash syntax OK.
 *   8) Backup file naming pattern xuantoi-<TS>.sql.gz được dùng (grep
 *      OUT= trong source) — guard tránh regression filename.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const BACKUP = resolve(REPO_ROOT, 'scripts/backup-db.sh');
const RESTORE = resolve(REPO_ROOT, 'scripts/restore-db.sh');
const VERIFY = resolve(REPO_ROOT, 'scripts/verify-restore.sh');

function bashSyntaxOk(path: string): boolean {
  const r = spawnSync('bash', ['-n', path], { encoding: 'utf8' });
  return r.status === 0;
}

describe('Phase 17.4 ops scripts smoke', () => {
  describe('files present', () => {
    it.each([
      ['backup', BACKUP],
      ['restore', RESTORE],
      ['verify', VERIFY],
    ])('%s script exists', (_label, path) => {
      expect(existsSync(path)).toBe(true);
    });

    it.each([BACKUP, RESTORE, VERIFY])(
      '%s starts with bash shebang',
      (path) => {
        const head = readFileSync(path, 'utf8').split('\n')[0];
        expect(head).toMatch(/^#!.*bash/);
      },
    );
  });

  describe('bash -n syntax', () => {
    it('backup-db.sh', () => {
      expect(bashSyntaxOk(BACKUP)).toBe(true);
    });
    it('restore-db.sh', () => {
      expect(bashSyntaxOk(RESTORE)).toBe(true);
    });
    it('verify-restore.sh', () => {
      expect(bashSyntaxOk(VERIFY)).toBe(true);
    });
  });

  describe('restore-db.sh safety guards', () => {
    it('exit 1 + Usage message when missing backup file argument', () => {
      const r = spawnSync('bash', [RESTORE], {
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'development' },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Usage');
    });

    it('exit 2 when backup file not found', () => {
      const r = spawnSync('bash', [RESTORE, '/nonexistent/xuantoi-foo.sql.gz'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          CONFIRM_RESTORE: 'YES',
        },
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('backup file not found');
    });

    it('exit 9 when NODE_ENV=production và không có ALLOW_PRODUCTION_RESTORE', () => {
      const r = spawnSync('bash', [RESTORE, '/tmp/whatever.sql.gz'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          CONFIRM_RESTORE: 'YES',
          ALLOW_PRODUCTION_RESTORE: '',
        },
      });
      expect(r.status).toBe(9);
      expect(r.stderr).toContain('NODE_ENV=production');
      expect(r.stderr).toContain('ALLOW_PRODUCTION_RESTORE');
    });

    it('không leak password mặc định trong stderr (mask ***)', () => {
      const r = spawnSync('bash', [RESTORE, '/nonexistent.sql.gz'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          CONFIRM_RESTORE: 'YES',
          DATABASE_URL: 'postgresql://leaky:supersecret@localhost:5432/mtt',
        },
      });
      const combined = `${r.stdout}\n${r.stderr}`;
      expect(combined).not.toContain('supersecret');
    });
  });

  describe('backup-db.sh DRY_RUN', () => {
    it('DRY_RUN=1 exit 0 nhanh, không cần pg_dump/docker', () => {
      const r = spawnSync('bash', [BACKUP], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DRY_RUN: '1',
          // Force docker mode to bỏ qua host pg_dump auto-detect (tránh phụ
          // thuộc vào tooling CI). Khi DRY_RUN=1 script exit ngay TRƯỚC
          // khi gọi docker exec — cờ này chỉ để pass strategy detect.
          USE_DOCKER: '1',
          DATABASE_URL: 'postgresql://mtt:mtt@localhost:5432/mtt',
          BACKUP_DIR: '/tmp/xuantoi-backup-dryrun',
        },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('DRY_RUN=1');
    });

    it('output naming pattern xuantoi-<TS>.sql.gz được giữ trong source', () => {
      const src = readFileSync(BACKUP, 'utf8');
      // Guard tránh regression naming khi ai đó refactor filename format.
      expect(src).toMatch(/xuantoi-\$TIMESTAMP\.sql\.gz/);
    });

    it('không leak password mặc định trong stdout (DRY_RUN)', () => {
      const r = spawnSync('bash', [BACKUP], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DRY_RUN: '1',
          USE_DOCKER: '1',
          DATABASE_URL: 'postgresql://leaky:supersecret@localhost:5432/mtt',
        },
      });
      const combined = `${r.stdout}\n${r.stderr}`;
      expect(combined).not.toContain('supersecret');
    });
  });

  describe('package.json npm scripts', () => {
    it('có backup:db / restore:db / verify:restore script', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
      ) as { scripts?: Record<string, string> };
      expect(pkg.scripts?.['backup:db']).toBeTruthy();
      expect(pkg.scripts?.['restore:db']).toBeTruthy();
      expect(pkg.scripts?.['verify:restore']).toBeTruthy();
    });
  });

  describe('docs/RUNBOOK.md', () => {
    it('tồn tại + có severity table', () => {
      const path = resolve(REPO_ROOT, 'docs/RUNBOOK.md');
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, 'utf8');
      expect(content).toContain('P0');
      expect(content).toContain('P1');
      expect(content).toContain('P2');
      expect(content).toContain('P3');
      expect(content).toContain('Backup restore procedure');
      expect(content).toContain('Postgres');
      expect(content).toContain('Redis');
    });
  });
});

// Unused import guard (silence TS warning on Node child_process).
void execFileSync;
