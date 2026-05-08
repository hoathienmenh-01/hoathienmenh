/**
 * Lock-in: chống commit secret thật vào repo.
 *
 * Mỗi `.env*` file trong workspace phải:
 *  - HOẶC là `.env.example` chỉ chứa placeholder (`change-me-*` hoặc rỗng).
 *  - HOẶC bị `.gitignore` ignore (không được tracked bởi git).
 *
 * Production secret thật (≥ 32 ký tự ngẫu nhiên) commit nhầm sẽ leak qua git
 * history → ngay cả khi rotate vẫn lộ. Test này rejection-style, fail tại CI
 * trước khi PR merge.
 *
 * Quét: 4 file `.env*` cố định (`apps/{api,web}/.env{,.example}`). Hard-code
 * danh sách (không glob) để test deterministic + nhanh.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, resolve } from 'path';

/** Resolve repo root từ apps/api/src/ → ../../../  */
const REPO_ROOT = resolve(dirname(__filename), '..', '..', '..');

const ENV_PATHS = {
  apiExample: 'apps/api/.env.example',
  apiActual: 'apps/api/.env',
  webExample: 'apps/web/.env.example',
  webActual: 'apps/web/.env',
} as const;

/** Placeholder values cho phép trong .env.example (không phải secret thật). */
const ALLOWED_PLACEHOLDERS = new Set<string>([
  'change-me-access-secret',
  'change-me-refresh-secret',
  'change-me-bootstrap-pass',
  'dev-access-secret',
  'dev-refresh-secret',
]);

/** Key name pattern coi là secret material, value cần kiểm tra. */
const SECRET_KEY_RE = /(SECRET|PASSWORD|TOKEN|KEY)$/i;

interface ParsedEnvLine {
  key: string;
  value: string;
}

function parseEnv(content: string): ParsedEnvLine[] {
  const out: ParsedEnvLine[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip quotes (.env.example dùng `"..."` cho value chứa space).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ key, value });
  }
  return out;
}

describe('security / .env files không leak secret thật', () => {
  it('apps/api/.env.example chỉ có placeholder (không secret >= 32 ký tự ngẫu nhiên)', () => {
    const p = join(REPO_ROOT, ENV_PATHS.apiExample);
    expect(existsSync(p)).toBe(true);
    const lines = parseEnv(readFileSync(p, 'utf-8'));
    expect(lines.length).toBeGreaterThan(0);

    for (const { key, value } of lines) {
      if (!SECRET_KEY_RE.test(key)) continue;
      // SECRET-like key: phải rỗng, hoặc placeholder allowed, hoặc < 32 ký tự
      // (giá trị "thật" dùng cho production thường ≥ 32 ký tự ngẫu nhiên).
      if (value === '') continue;
      if (ALLOWED_PLACEHOLDERS.has(value)) continue;
      expect(
        value.length < 32,
        `apps/api/.env.example key=${key} value dài ${value.length} ký tự — nghi là secret thật. Thêm vào ALLOWED_PLACEHOLDERS hoặc rút ngắn.`,
      ).toBe(true);
    }
  });

  it('apps/web/.env.example chỉ có VITE_* (không key SECRET/PASSWORD/TOKEN)', () => {
    const p = join(REPO_ROOT, ENV_PATHS.webExample);
    expect(existsSync(p)).toBe(true);
    const lines = parseEnv(readFileSync(p, 'utf-8'));
    for (const { key } of lines) {
      // Web-side .env phải chỉ là VITE_* config (sẽ inline vào bundle public).
      // KHÔNG được có SECRET / PASSWORD / private TOKEN.
      expect(
        !SECRET_KEY_RE.test(key) || key.startsWith('VITE_'),
        `apps/web/.env.example chứa key sensitive ${key} — Vite sẽ inline vào bundle public. Không được commit secret-like ở đây.`,
      ).toBe(true);
    }
  });

  it.each([ENV_PATHS.apiActual, ENV_PATHS.webActual])(
    '%s phải bị .gitignore ignore (không được commit)',
    (relPath) => {
      const fullPath = join(REPO_ROOT, relPath);
      let ignored = false;
      try {
        // `git check-ignore` exit 0 nếu path được ignore, exit 1 nếu không.
        execSync(`git check-ignore -q ${JSON.stringify(fullPath)}`, {
          cwd: REPO_ROOT,
          stdio: 'pipe',
        });
        ignored = true;
      } catch {
        ignored = false;
      }
      expect(
        ignored,
        `${relPath} không bị .gitignore ignore — risk commit secret thật. Kiểm tra .gitignore root.`,
      ).toBe(true);
    },
  );

  it('.env (không suffix) bị ignore ở root .gitignore', () => {
    const gitignorePath = join(REPO_ROOT, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf-8');
    // Lines (sau strip comment) phải có rule cover `.env`.
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const hasEnvIgnore = lines.some(
      (l) => l === '.env' || l === '*.env' || l === '**/.env',
    );
    expect(
      hasEnvIgnore,
      '.gitignore chưa có dòng `.env` — risk commit `apps/*/env`. Thêm `.env` vào root .gitignore.',
    ).toBe(true);
    // Phải KHÔNG ignore `.env.example` (whitelist).
    expect(lines).toContain('!.env.example');
  });

  it('apps/api/.env (nếu tồn tại local) KHÔNG được track bởi git', () => {
    const apiActualPath = join(REPO_ROOT, ENV_PATHS.apiActual);
    if (!existsSync(apiActualPath)) {
      // Skip — không có local .env (CI fresh checkout).
      return;
    }
    let trackedOutput = '';
    try {
      trackedOutput = execSync(
        `git ls-files --error-unmatch ${JSON.stringify(apiActualPath)}`,
        { cwd: REPO_ROOT, stdio: 'pipe' },
      ).toString();
    } catch {
      // Exit code 1 = file không tracked → ok (đúng mong đợi).
      trackedOutput = '';
    }
    expect(
      trackedOutput.trim(),
      `apps/api/.env đã bị commit vào git (output: ${trackedOutput}). Phải remove khỏi index: git rm --cached apps/api/.env.`,
    ).toBe('');
  });
});
